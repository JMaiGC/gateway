import { AZURE_OPEN_AI, GOOGLE } from "../globals.js";
import { getStreamModeSplitPattern } from "../utils.js";

export async function* readStream(reader: ReadableStreamDefaultReader, splitPattern: string, transformFunction: Function | undefined, isSleepTimeRequired: boolean, fallbackChunkId: string) {
    let buffer = '';
    let decoder = new TextDecoder();
    let isFirstChunk = true;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            if (buffer.length > 0) {
                if (transformFunction) {
                    yield transformFunction(buffer, fallbackChunkId);
                } else {
                    yield buffer
                }
            }
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        // keep buffering until we have a complete chunk

        while (buffer.split(splitPattern).length > 1) {
            let parts = buffer.split(splitPattern);
            let lastPart = parts.pop() ?? "";  // remove the last part from the array and keep it in buffer
            for (let part of parts) {
                // Some providers send ping event which can be ignored during parsing

                if (part.length > 0) {
                    if (isFirstChunk) {
                        isFirstChunk = false;
                        await new Promise(resolve => setTimeout(resolve, 25));
                    } else if (isSleepTimeRequired) {
                        await new Promise(resolve => setTimeout(resolve, 1));
                    }

                    if (transformFunction) {
                        const transformedChunk = transformFunction(part, fallbackChunkId);
                        if (transformedChunk !== undefined) {
                            yield transformedChunk;
                        }
                    } else {
                        yield part + splitPattern;
                    }
                }
            }
            
            buffer = lastPart;  // keep the last part (after the last '\n\n') in buffer
        }
    }
}

export async function handleNonStreamingMode(response: Response, responseTransformer: Function | undefined) {
    let responseBodyJson = await response.json();
    if (responseTransformer) {
        responseBodyJson = responseTransformer(responseBodyJson, response.status);
    }

    return new Response(JSON.stringify(responseBodyJson), response);
}

export async function handleAudioResponse(response: Response) {
    return new Response(JSON.stringify(response.body), response);
}

export async function handleOctetStreamResponse(response: Response) {
    return new Response(JSON.stringify(response.body), response);
}


export async function handleStreamingMode(response: Response, proxyProvider: string, responseTransformer: Function | undefined, requestURL: string): Promise<Response> {
    const splitPattern = getStreamModeSplitPattern(proxyProvider, requestURL);
    const fallbackChunkId = Date.now().toString();

    if (!response.body) {
        throw new Error("Response format is invalid. Body not found");
    }
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = response.body.getReader();
    const isSleepTimeRequired = proxyProvider === AZURE_OPEN_AI ? true : false;
    const encoder = new TextEncoder();

    (async () => {
        for await (const chunk of readStream(reader, splitPattern, responseTransformer, isSleepTimeRequired, fallbackChunkId)) {
            await writer.write(encoder.encode(chunk));
        }
        writer.close();
    })();

    // Convert GEMINI json stream to text/event-stream for non-proxy calls
    if (proxyProvider === GOOGLE && responseTransformer) {
        return new Response(readable, {
            ...response,
            headers: new Headers({
                ...Object.fromEntries(response.headers),
                'content-type': "text/event-stream"
            })
        });
    }

    return new Response(readable, response);
}

