import {
  HookEventType,
  PluginContext,
  PluginHandler,
  PluginParameters,
} from '../types';
import { getText } from '../utils';
import { PORTKEY_ENDPOINTS, fetchPortkey } from './globals';

export async function detectPII(
  textArray: Array<string> | string,
  credentials: any,
  env: Record<string, any>
): Promise<
  Array<{
    detectedPIICategories: Array<string>;
    PIIData: Array<any>;
    redactedText: string;
  }>
> {
  const result = await fetchPortkey(env, PORTKEY_ENDPOINTS.PII, credentials, {
    input: textArray,
  });
  const mappedResult: Array<any> = [];

  result.forEach((item: any) => {
    // Identify all the PII categories in the text
    let detectedPIICategories = item.entities
      .map((entity: any) => {
        return Object.keys(entity.labels);
      })
      .flat()
      .filter((value: any, index: any, self: string | any[]) => {
        return self.indexOf(value) === index;
      });

    // Generate the detailed data to be sent along with detectedPIICategories
    let detailedData = item.entities.map((entity: any) => {
      return {
        text: entity.text,
        labels: entity.labels,
      };
    });

    mappedResult.push({
      detectedPIICategories,
      PIIData: detailedData,
      redactedText: item.processed_text,
    });
  });

  return mappedResult;
}

export const handler: PluginHandler = async (
  context: PluginContext,
  parameters: PluginParameters,
  eventType: HookEventType,
  options
) => {
  let error = null;
  let verdict = false;
  let data: any = null;

  try {
    const text = getText(context, eventType);
    const categoriesToCheck = parameters.categories;
    const not = parameters.not || false;

    let { detectedPIICategories, PIIData } =
      (
        await detectPII(text, parameters.credentials, options?.env || {})
      )?.[0] || {};

    let filteredCategories = detectedPIICategories.filter((category: string) =>
      categoriesToCheck.includes(category)
    );

    const hasPII = filteredCategories.length > 0;
    verdict = not ? !hasPII : !hasPII;

    data = {
      verdict,
      not,
      explanation: verdict
        ? not
          ? 'PII was found in the text as expected.'
          : 'No restricted PII was found in the text.'
        : not
          ? 'No PII was found in the text when it should have been.'
          : `Found restricted PII in the text: ${filteredCategories.join(', ')}`,
      detectedPII: PIIData,
      restrictedCategories: categoriesToCheck,
      detectedCategories: detectedPIICategories,
      textExcerpt: text.length > 100 ? text.slice(0, 100) + '...' : text,
    };
  } catch (e) {
    error = e as Error;
    const text = getText(context, eventType);
    data = {
      explanation: `An error occurred while checking for PII: ${error.message}`,
      not: parameters.not || false,
      restrictedCategories: parameters.categories || [],
      textExcerpt: text
        ? text.length > 100
          ? text.slice(0, 100) + '...'
          : text
        : 'No text available',
    };
  }

  return { error, verdict, data };
};
