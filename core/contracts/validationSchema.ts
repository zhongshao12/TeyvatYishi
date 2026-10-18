export type SchemaDescription = Record<string, unknown>;
export type SchemaCheck = (value: unknown) => boolean;
type Describe = (reference: (check: SchemaCheck) => SchemaDescription) => SchemaDescription;
const descriptions = new WeakMap<SchemaCheck, Describe>();
const rules = new Map<string, SchemaCheck>();

export function described(check: SchemaCheck, describe: Describe): SchemaCheck {
  descriptions.set(check, describe);
  return check;
}

export function ruled(name: string, base: SchemaCheck, predicate: SchemaCheck): SchemaCheck {
  const check = (value: unknown) => base(value) && predicate(value);
  rules.set(name, predicate);
  return described(check, ref => ({ kind: 'rule', name, base: ref(base) }));
}

/** Functions keep validating normally; only the structural descriptions cross IPC. */
export function describeChecks(entries: Record<string, SchemaCheck>): Record<string, SchemaDescription> {
  const names = new Map(Object.entries(entries).map(([name, check]) => [check, name]));
  const anonymous = (check: SchemaCheck): SchemaDescription => {
    const describe = descriptions.get(check);
    if (!describe) throw new Error('CORE2_UNDESCRIBED_CHECK');
    return describe(reference);
  };
  const reference = (check: SchemaCheck): SchemaDescription => {
    const name = names.get(check);
    return name ? { kind: 'ref', name } : anonymous(check);
  };
  return Object.fromEntries(Object.entries(entries).map(([name, check]) => [name, anonymous(check)]));
}

export function checkDescription(schemas: Record<string, SchemaDescription>, kind: string, value: unknown): boolean {
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const check = (schema: SchemaDescription | undefined, value: unknown, depth: number): boolean => {
    if (!schema || depth > 200) return false;
    switch (schema.kind) {
      case 'ref': return typeof schema.name === 'string' && check(schemas[schema.name], value, depth + 1);
      case 'any': return true;
      case 'text': return typeof value === 'string';
      case 'nonEmpty': return typeof value === 'string' && value.trim().length > 0;
      case 'id': return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(value);
      case 'finite': return typeof value === 'number' && Number.isFinite(value);
      case 'nat': return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      case 'positive': return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
      case 'bool': return typeof value === 'boolean';
      case 'imageLink': return typeof value === 'string' && !/^(?:data:|blob:)/i.test(value);
      case 'one': return Array.isArray(schema.values) && schema.values.includes(value);
      case 'optional': return value === undefined || check(schema.item as SchemaDescription, value, depth + 1);
      case 'nullable': return value === null || check(schema.item as SchemaDescription, value, depth + 1);
      case 'or': return Array.isArray(schema.items) && schema.items.some(item => check(item as SchemaDescription, value, depth + 1));
      case 'list': return Array.isArray(value) && value.length >= (schema.min as number) && value.every(item => check(schema.item as SchemaDescription, item, depth + 1));
      case 'dictionary': return object(value) && Object.values(value).every(item => check(schema.item as SchemaDescription, item, depth + 1));
      case 'bounded': return check(schema.item as SchemaDescription, value, depth + 1) && typeof value === 'number' && value <= (schema.max as number);
      case 'object': {
        if (!object(value) || !object(schema.fields)) return false;
        return Object.keys(value).every(key => Object.hasOwn(schema.fields as object, key)) && Object.entries(schema.fields).every(([key, item]) => check(item as SchemaDescription, value[key], depth + 1));
      }
      case 'switch': return object(value) && typeof schema.field === 'string' && typeof value[schema.field] === 'string' && object(schema.cases) &&
        Object.hasOwn(schema.cases, value[schema.field] as string) && check(schema.cases[value[schema.field] as string] as SchemaDescription, value, depth + 1);
      case 'rule': return typeof schema.name === 'string' && rules.has(schema.name) && check(schema.base as SchemaDescription, value, depth + 1) && rules.get(schema.name)!(value);
      default: return false;
    }
  };
  return Object.hasOwn(schemas, kind) && check(schemas[kind], value, 0);
}
