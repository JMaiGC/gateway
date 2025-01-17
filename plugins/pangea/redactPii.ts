import {
  HookEventType,
  PluginContext,
  PluginHandler,
  PluginParameters,
} from '../types';
import { getCurrentContentPart, post, setCurrentContentPart } from '../utils';
import { VERSION } from './version';

export const handler: PluginHandler = async (
  context: PluginContext,
  parameters: PluginParameters,
  eventType: HookEventType
) => {
  let transformedData = {
    request: {
      json: null,
    },
    response: {
      json: null,
    },
  };

  try {
    if (!parameters.credentials?.domain) {
      return {
        error: `'parameters.credentials.domain' must be set`,
        verdict: true,
        data: null,
      };
    }

    if (!parameters.credentials?.apiKey) {
      return {
        error: `'parameters.credentials.apiKey' must be set`,
        verdict: true,
        data: null,
      };
    }

    const url = `https://redact.${parameters.credentials.domain}/v1/redact_structured`;

    const { content } = getCurrentContentPart(context, eventType);

    if (!content) {
      return {
        error: { message: 'request or response json is empty' },
        verdict: true,
        data: null,
        transformedData,
      };
    }

    const requestOptions = {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'portkey-ai-plugin/' + VERSION,
        Authorization: `Bearer ${parameters.credentials.apiKey}`,
      },
    };
    const request = {
      data: content,
      ...(Array.isArray(content) && content[0]?.type === 'text'
        ? { jsonp: ['$[*].text'] }
        : {}),
    };

    const response = await post(url, request, requestOptions);

    if (response.result?.count > 0 && response.result.redacted_data) {
      setCurrentContentPart(
        context,
        eventType,
        transformedData,
        response.result.redacted_data
      );
    }

    return {
      error: null,
      verdict: true,
      data: {
        summary: response.summary,
      },
      transformedData,
    };
  } catch (e) {
    return {
      error: e as Error,
      verdict: true,
      data: null,
      transformedData,
    };
  }
};
