import type { CoreScope } from '../contracts/identity';
import type { MemorySettings, JobRecord } from '../contracts/memory';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { stableJson, sameScope } from '../persistence/repositoryValidation';

interface CoreSummaryPlan { version: 1; scope: CoreScope; operationId: string; settings: MemorySettings }
const PREFIX = 'core2-summary-plan-v1:';
export const DEFAULT_CORE_MEMORY_SETTINGS: MemorySettings = { mode: 'local', shortThreshold: 15, middleThreshold: 15, longThreshold: 15, prompt: '' };
function ownSettings(input: MemorySettings): MemorySettings {
  if (!isCoreJsonData(input) || !input || !Object.keys(input).every(key => ['mode', 'shortThreshold', 'middleThreshold', 'longThreshold', 'prompt'].includes(key))
    || !['local', 'model'].includes(input.mode) || typeof input.prompt !== 'string' || ![input.shortThreshold, input.middleThreshold, input.longThreshold].every(value => Number.isSafeInteger(value) && value >= 2)) throw Error('CORE2_SUMMARY_SETTINGS_INVALID');
  return structuredClone(input);
}
/** No endpoint, model credentials or hidden reasoning enter this persisted plan. */
export function freezeCoreSummarySettings(input?: MemorySettings): MemorySettings { return ownSettings(input ?? DEFAULT_CORE_MEMORY_SETTINGS); }
export function coreSummaryFingerprint(scope: CoreScope, operationId: string, settings: MemorySettings): string {
  return PREFIX + stableJson({ version: 1, scope, operationId, settings: ownSettings(settings) });
}
export function readCoreSummaryPlan(job: JobRecord): CoreSummaryPlan {
  if (job.kind !== 'turn_summary' || !job.configFingerprint.startsWith(PREFIX)) throw Error('CORE2_SUMMARY_PLAN_UNSUPPORTED');
  const parsed: unknown = JSON.parse(job.configFingerprint.slice(PREFIX.length));
  if (!isCoreJsonData(parsed) || !parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => !['version', 'scope', 'operationId', 'settings'].includes(key))) throw Error('CORE2_SUMMARY_PLAN_INVALID');
  const plan = parsed as CoreSummaryPlan;
  if (plan.version !== 1 || !validateCoreDto('scope', plan.scope).ok || !sameScope(plan.scope, job.scope) || plan.operationId !== job.operationId) throw Error('CORE2_SUMMARY_PLAN_BINDING');
  return { ...plan, settings: ownSettings(plan.settings) };
}
