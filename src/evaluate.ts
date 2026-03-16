import * as crypto from 'crypto';
import { FeatureFlag, FlagEvalResult } from './types';

export function evaluateFlag(
  flag: FeatureFlag,
  userId?: string,
  userAttributes?: Record<string, any>,
): FlagEvalResult {
  if (!flag.enabled) {
    return { enabled: false, value: flag.defaultValue ?? false };
  }

  if (flag.targetingRules && Object.keys(flag.targetingRules).length > 0) {
    if (!evaluateTargetingRules(flag.targetingRules, userAttributes || {})) {
      return { enabled: false, value: flag.defaultValue ?? false };
    }
  }

  if (userId) {
    const bucket = getBucket(userId, flag.key);
    if (bucket >= flag.rolloutPercentage) {
      return { enabled: false, value: flag.defaultValue ?? false };
    }
  }

  if (flag.variants && flag.variants.length > 0) {
    const variantBucket = getVariantBucket(userId || '', flag.key);
    let cumulative = 0;
    for (const variant of flag.variants) {
      cumulative += variant.weight;
      if (variantBucket < cumulative) {
        return { enabled: true, value: variant.value, variant: variant.key };
      }
    }
    return {
      enabled: true,
      value: flag.variants[0].value,
      variant: flag.variants[0].key,
    };
  }

  return { enabled: true, value: true };
}

function evaluateTargetingRules(
  rules: Record<string, any>,
  userContext: Record<string, any>,
): boolean {
  // Handle nested { operator, rules } format from dashboard
  if (rules.rules && Array.isArray(rules.rules)) {
    const op = (rules.operator || 'AND').toUpperCase();
    if (op === 'OR') return rules.rules.some((r: any) => evaluateNestedRule(r, userContext));
    return rules.rules.every((r: any) => evaluateNestedRule(r, userContext));
  }
  // Legacy flat format
  for (const [key, rule] of Object.entries(rules)) {
    if (!evaluateRule(key, rule, userContext)) return false;
  }
  return true;
}

function evaluateNestedRule(rule: { attribute: string; operator: string; value: any }, context: Record<string, any>): boolean {
  const userValue = context[rule.attribute];
  switch (rule.operator) {
    case 'equals': return userValue === rule.value;
    case 'not_equals': case 'notEquals': return userValue !== rule.value;
    case 'in': {
      const list = typeof rule.value === 'string' ? rule.value.split(',').map((s: string) => s.trim()) : rule.value;
      return Array.isArray(list) && list.includes(userValue);
    }
    case 'not_in': case 'notIn': {
      const list = typeof rule.value === 'string' ? rule.value.split(',').map((s: string) => s.trim()) : rule.value;
      return !Array.isArray(list) || !list.includes(userValue);
    }
    case 'greater_than': case 'greaterThan': return typeof userValue === 'number' && userValue > Number(rule.value);
    case 'less_than': case 'lessThan': return typeof userValue === 'number' && userValue < Number(rule.value);
    case 'contains': return typeof userValue === 'string' && userValue.includes(String(rule.value));
    case 'regex': return typeof userValue === 'string' && new RegExp(String(rule.value)).test(userValue);
    case 'exists': return rule.value ? userValue != null : userValue == null;
    default: return userValue === rule.value;
  }
}

function evaluateRule(key: string, rule: any, context: Record<string, any>): boolean {
  const value = context[key];

  if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    if ('equals' in rule) return value === rule.equals;
    if ('notEquals' in rule) return value !== rule.notEquals;
    if ('in' in rule && Array.isArray(rule.in)) return rule.in.includes(value);
    if ('notIn' in rule && Array.isArray(rule.notIn)) return !rule.notIn.includes(value);
    if ('greaterThan' in rule) return typeof value === 'number' && value > rule.greaterThan;
    if ('lessThan' in rule) return typeof value === 'number' && value < rule.lessThan;
    if ('greaterThanOrEqual' in rule) return typeof value === 'number' && value >= rule.greaterThanOrEqual;
    if ('lessThanOrEqual' in rule) return typeof value === 'number' && value <= rule.lessThanOrEqual;
    if ('contains' in rule) return typeof value === 'string' && value.includes(rule.contains);
    if ('regex' in rule) return typeof value === 'string' && new RegExp(rule.regex).test(value);
    if ('exists' in rule) return rule.exists ? value != null : value == null;
    if ('and' in rule && Array.isArray(rule.and)) {
      return rule.and.every((r: any) => evaluateRule(key, r, context));
    }
    if ('or' in rule && Array.isArray(rule.or)) {
      return rule.or.some((r: any) => evaluateRule(key, r, context));
    }
  }

  return value === rule;
}

function getBucket(userId: string, salt: string): number {
  const hash = crypto.createHash('md5').update(`${userId}:${salt}`).digest('hex');
  return parseInt(hash.substring(0, 8), 16) % 100;
}

function getVariantBucket(userId: string, flagKey: string): number {
  const hash = crypto.createHash('md5').update(`${userId}:${flagKey}:variant`).digest('hex');
  return parseInt(hash.substring(0, 8), 16) % 100;
}
