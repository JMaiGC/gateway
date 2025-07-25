import {
  Check,
  EventType,
  GuardrailCheckResult,
  GuardrailFeedback,
  HookSpanContext,
  HookObject,
  HookOnFailObject,
  HookOnSuccessObject,
  HookResult,
  HandlerOptions,
  HookType,
} from './types';
import { plugins } from '../../../plugins';
import { Context } from 'hono';
import { HOOKS_EVENT_TYPE_PRESETS } from './globals';

export class HookSpan {
  private context: HookSpanContext;
  private beforeRequestHooks: HookObject[];
  private afterRequestHooks: HookObject[];
  private hooksResult: {
    beforeRequestHooksResult: HookResult[];
    afterRequestHooksResult: HookResult[];
  };
  private parentHookSpanId: string | null;
  public readonly id: string;

  constructor(
    requestParams: Record<string, any>,
    metadata: Record<string, string>,
    provider: string,
    isStreamingRequest: boolean,
    beforeRequestHooks: HookObject[],
    afterRequestHooks: HookObject[],
    parentHookSpanId: string | null,
    requestType: string,
    requestHeaders: Record<string, string>
  ) {
    this.context = this.createContext(
      requestParams,
      metadata,
      provider,
      isStreamingRequest,
      requestType,
      requestHeaders
    );
    this.beforeRequestHooks = this.initializeHooks(
      beforeRequestHooks,
      'beforeRequestHook'
    );
    this.afterRequestHooks = this.initializeHooks(
      afterRequestHooks,
      'afterRequestHook'
    );
    this.parentHookSpanId = parentHookSpanId;
    this.hooksResult = {
      beforeRequestHooksResult: [],
      afterRequestHooksResult: [],
    };
    this.id = crypto.randomUUID();
  }

  private createContext(
    requestParams: Record<string, any>,
    metadata: Record<string, string>,
    provider: string,
    isStreamingRequest: boolean,
    requestType: string,
    requestHeaders: Record<string, string>
  ): HookSpanContext {
    const requestText = this.extractRequestText(requestParams);
    return {
      request: {
        json: requestParams,
        text: requestText,
        isStreamingRequest,
        isTransformed: false,
        headers: requestHeaders,
      },
      response: {
        json: {},
        text: '',
        statusCode: null,
        isTransformed: false,
      },
      provider,
      requestType,
      metadata,
    };
  }

  private extractRequestText(requestParams: any): string {
    if (requestParams?.prompt) {
      return requestParams.prompt;
    } else if (requestParams?.messages?.length) {
      const lastMessage =
        requestParams.messages[requestParams.messages.length - 1];
      const concatenatedText = Array.isArray(lastMessage.content)
        ? lastMessage.content
            .map((contentPart: any) => contentPart.text)
            .join('\n')
        : '';
      return concatenatedText || lastMessage.content;
    } else if (requestParams?.input) {
      return Array.isArray(requestParams.input)
        ? requestParams.input.join('\n')
        : requestParams.input;
    }
    return '';
  }

  private initializeHooks(
    hooks: HookObject[],
    eventType: EventType
  ): HookObject[] {
    return hooks.map((hook) => ({ ...hook, eventType }));
  }

  public setContextResponse(
    responseJSON: Record<string, any>,
    responseStatus: number
  ): void {
    const responseText = this.extractResponseText(responseJSON);
    this.context.response = {
      json: responseJSON,
      text: responseText,
      statusCode: responseStatus,
      isTransformed: this.context.response.isTransformed || false,
    };
  }

  public setContextAfterTransform(
    responseJson: Record<string, any>,
    requestJson: Record<string, any>
  ): void {
    if (responseJson) {
      this.context.response.json = responseJson;
      this.context.response.text = this.extractResponseText(responseJson);
      this.context.response.isTransformed = true;
    }

    if (requestJson) {
      this.context.request.json = requestJson;
      this.context.request.text = this.extractRequestText(requestJson);
      this.context.request.isTransformed = true;
    }
  }

  private extractResponseText(responseJSON: Record<string, any>): string {
    if (responseJSON?.choices?.length) {
      const choice = responseJSON.choices[0];
      if (choice.text) {
        return choice.text;
      } else if (choice?.message?.content) {
        return choice.message.content.text || choice.message.content;
      }
    }
    return '';
  }

  public addHookResult(eventType: EventType, result: HookResult): void {
    if (eventType === 'beforeRequestHook') {
      this.hooksResult.beforeRequestHooksResult.push(result);
    } else if (eventType === 'afterRequestHook') {
      this.hooksResult.afterRequestHooksResult.push(result);
    }
  }

  public resetHookResult(eventType: EventType): void {
    if (eventType === 'beforeRequestHook') {
      this.hooksResult.beforeRequestHooksResult = [];
    } else if (eventType === 'afterRequestHook') {
      this.hooksResult.afterRequestHooksResult = [];
    }
  }

  public getContext(): HookSpanContext {
    return this.context;
  }

  public getBeforeRequestHooks(): HookObject[] {
    return this.beforeRequestHooks;
  }

  public getAfterRequestHooks(): HookObject[] {
    return this.afterRequestHooks;
  }

  public getParentHookSpanId(): string | null {
    return this.parentHookSpanId;
  }

  public getHooksResult(): {
    beforeRequestHooksResult: HookResult[];
    afterRequestHooksResult: HookResult[];
  } {
    return this.hooksResult;
  }
}

export class HooksManager {
  private spans: Record<string, HookSpan> = {};
  private plugins: any;

  constructor() {
    this.plugins = plugins;
  }

  public createSpan(
    requestParams: any,
    metadata: Record<string, string>,
    provider: string,
    isStreamingRequest: boolean,
    beforeRequestHooks: HookObject[],
    afterRequestHooks: HookObject[],
    parentHookSpanId: string | null,
    requestType: string,
    requestHeaders: Record<string, string>
  ): HookSpan {
    const span = new HookSpan(
      requestParams,
      metadata,
      provider,
      isStreamingRequest,
      beforeRequestHooks,
      afterRequestHooks,
      parentHookSpanId,
      requestType,
      requestHeaders
    );

    this.spans[span.id] = span;
    return span;
  }

  public setSpanContextResponse(
    spanId: string,
    responseJson: Record<string, any>,
    responseStatusCode: number
  ): void {
    const span = this.getSpan(spanId);
    span.setContextResponse(responseJson, responseStatusCode);
  }

  public async executeHooks(
    spanId: string,
    eventTypePresets: string[],
    options: HandlerOptions
  ): Promise<{ results: HookResult[]; shouldDeny: boolean }> {
    const span = this.getSpan(spanId);

    const hooksToExecute = this.getHooksToExecute(span, eventTypePresets);

    if (hooksToExecute.length === 0) {
      return { results: [], shouldDeny: false };
    }

    try {
      const results = await Promise.all(
        hooksToExecute.map((hook) =>
          this.executeEachHook(spanId, hook, options)
        )
      );
      const shouldDeny = results.some(
        (result, index) =>
          !result.verdict && hooksToExecute[index].deny && !result.skipped
      );

      return { results, shouldDeny };
    } catch (err) {
      console.error(`Error executing hooks:`, err);
      return { results: [], shouldDeny: false };
    }
  }

  public getSpan(spanId: string): HookSpan {
    const span = this.spans[spanId] || {};
    return span;
  }

  private async executeFunction(
    context: HookSpanContext,
    check: Check,
    eventType: EventType,
    options: HandlerOptions
  ): Promise<GuardrailCheckResult> {
    const [source, fn] = check.id.split('.');
    const createdAt = new Date();
    try {
      const result = await this.plugins[source][fn](
        context,
        check.parameters,
        eventType,
        options
      );
      return {
        transformedData: result.transformedData,
        data: result.data || null,
        verdict: result.verdict,
        id: check.id,
        error: result.error
          ? { name: result.error.name, message: result.error.message }
          : undefined,
        execution_time: new Date().getTime() - createdAt.getTime(),
        transformed: result.transformed || false,
        created_at: createdAt,
        log: result.log || null,
        fail_on_error:
          (check.parameters as Record<string, any>)?.failOnError || false,
      };
    } catch (err: any) {
      console.error(`Error executing check "${check.id}":`, err);
      return {
        error: {
          name: 'Check error',
          message: 'Error executing check',
        },
        verdict: false,
        data: null,
        id: check.id,
        execution_time: new Date().getTime() - createdAt.getTime(),
        created_at: createdAt,
      };
    }
  }

  private async executeEachHook(
    spanId: string,
    hook: HookObject,
    options: HandlerOptions
  ): Promise<HookResult> {
    const span = this.getSpan(spanId);
    let hookResult: HookResult = { id: hook.id, type: hook.type } as HookResult;
    let checkResults: GuardrailCheckResult[] = [];
    const createdAt = new Date();

    if (this.shouldSkipHook(span, hook)) {
      return { ...hookResult, skipped: true };
    }

    if (hook.type === HookType.MUTATOR && hook.checks) {
      for (const check of hook.checks) {
        const result = await this.executeFunction(
          span.getContext(),
          check,
          hook.eventType,
          options
        );
        if (
          result.transformedData &&
          (result.transformedData.response.json ||
            result.transformedData.request.json)
        ) {
          span.setContextAfterTransform(
            result.transformedData.response.json,
            result.transformedData.request.json
          );
        }
        delete result.transformedData;
        checkResults.push(result);
      }
    }

    if (hook.type === HookType.GUARDRAIL && hook.checks) {
      checkResults = await Promise.all(
        hook.checks
          .filter((check: Check) => check.is_enabled !== false)
          .map((check: Check) =>
            this.executeFunction(
              span.getContext(),
              check,
              hook.eventType,
              options
            )
          )
      );

      checkResults.forEach((checkResult) => {
        if (
          checkResult.transformedData &&
          (checkResult.transformedData.response.json ||
            checkResult.transformedData.request.json)
        ) {
          span.setContextAfterTransform(
            checkResult.transformedData.response.json,
            checkResult.transformedData.request.json
          );
        }
        delete checkResult.transformedData;
      });
    }

    hookResult = {
      // if guardrail has error, make verdict false else do the normal check
      verdict: checkResults.every(
        (result) => result.verdict || (result.error && !result.fail_on_error)
      ),
      id: hook.id,
      transformed: checkResults.some((result) => result.transformed),
      checks: checkResults,
      feedback: this.createFeedbackObject(
        checkResults,
        hook.onFail,
        hook.onSuccess
      ),
      execution_time: new Date().getTime() - createdAt.getTime(),
      async: hook.async || false,
      type: hook.type,
      created_at: createdAt,
    } as HookResult;

    if (hook.deny && !hookResult.verdict) {
      hookResult.deny = true;
    } else {
      hookResult.deny = false;
    }

    span.addHookResult(hook.eventType, hookResult);
    return hookResult;
  }

  private shouldSkipHook(span: HookSpan, hook: HookObject): boolean {
    const context = span.getContext();
    return (
      !['chatComplete', 'complete', 'embed'].includes(context.requestType) ||
      (context.requestType === 'embed' &&
        hook.eventType !== 'beforeRequestHook') ||
      (context.requestType === 'embed' && hook.type === HookType.MUTATOR) ||
      (hook.eventType === 'afterRequestHook' &&
        context.response.statusCode !== 200) ||
      (hook.eventType === 'beforeRequestHook' &&
        span.getParentHookSpanId() !== null) ||
      (hook.type === HookType.MUTATOR && !!hook.async)
    );
  }

  private createFeedbackObject(
    results: GuardrailCheckResult[],
    onFail?: HookOnFailObject,
    onSuccess?: HookOnSuccessObject
  ): GuardrailFeedback | null {
    const verdict = results.every((result) => result.verdict || result.error);
    const feedbackConfig = verdict ? onSuccess?.feedback : onFail?.feedback;

    if (!feedbackConfig) {
      return null;
    }

    return {
      value: feedbackConfig.value,
      weight: feedbackConfig.weight,
      metadata: {
        ...feedbackConfig.metadata,
        successfulChecks: this.getCheckIds(results, true),
        failedChecks: this.getCheckIds(results, false, false),
        erroredChecks: this.getCheckIds(results, false, true),
      },
    };
  }

  private getCheckIds(
    results: GuardrailCheckResult[],
    successful: boolean,
    errored: boolean = false
  ): string {
    return results
      .filter((result) =>
        successful
          ? result.verdict === true
          : result.verdict === false && errored === !!result.error
      )
      .map((result) => result.id)
      .join(', ');
  }

  public getHooksToExecute(
    span: HookSpan,
    eventTypePresets: string[]
  ): HookObject[] {
    const hooksToExecute: HookObject[] = [];
    if (
      eventTypePresets.includes(
        HOOKS_EVENT_TYPE_PRESETS.ASYNC_BEFORE_REQUEST_HOOK
      )
    ) {
      hooksToExecute.push(
        ...span.getBeforeRequestHooks().filter((h) => h.async)
      );
    }
    if (
      eventTypePresets.includes(
        HOOKS_EVENT_TYPE_PRESETS.SYNC_BEFORE_REQUEST_HOOK
      )
    ) {
      hooksToExecute.push(
        ...span.getBeforeRequestHooks().filter((h) => !h.async)
      );
    }
    if (
      eventTypePresets.includes(
        HOOKS_EVENT_TYPE_PRESETS.ASYNC_AFTER_REQUEST_HOOK
      )
    ) {
      hooksToExecute.push(
        ...span.getAfterRequestHooks().filter((h) => h.async)
      );
    }
    if (
      eventTypePresets.includes(
        HOOKS_EVENT_TYPE_PRESETS.SYNC_AFTER_REQUEST_HOOK
      )
    ) {
      hooksToExecute.push(
        ...span.getAfterRequestHooks().filter((h) => !h.async)
      );
    }

    return hooksToExecute;
  }
}

export const hooks = (c: Context, next: any) => {
  const hooksManager = new HooksManager();
  c.set('hooksManager', hooksManager);
  c.set('executeHooks', hooksManager.executeHooks.bind(hooksManager));
  return next();
};
