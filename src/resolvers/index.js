import Resolver from '@forge/resolver';
import api from "@forge/api";

const resolver = new Resolver();

function extractFirstRequirementNumber(payload) {
  if (!payload) {
    return undefined;
  }

  // Handle single object with a top-level requirementNumber
  if (payload && typeof payload === 'object' && 'requirementNumber' in payload) {
    return payload.requirementNumber;
  }

  const tryExtract = (item) => {
    if (item && typeof item === 'object' && 'requirementNumber' in item) {
      return item.requirementNumber;
    }
    return undefined;
  };

  if (Array.isArray(payload)) {
    return tryExtract(payload[0]);
  }

  if (Array.isArray(payload?.requirements)) {
    return tryExtract(payload.requirements[0]);
  }

  if (Array.isArray(payload?.items)) {
    return tryExtract(payload.items[0]);
  }

  if (Array.isArray(payload?.data)) {
    return tryExtract(payload.data[0]);
  }

  // Fallback: shallow search for first object with requirementNumber
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      const candidate = tryExtract(value[0]);
      if (candidate !== undefined) return candidate;
    } else if (value && typeof value === 'object') {
      const candidate = tryExtract(value);
      if (candidate !== undefined) return candidate;
    }
  }

  return undefined;
}

resolver.define('getText', async (req) => {
  const vitareq = api.asUser().withProvider('vitareq', 'vitareq-api')

  if (!(await vitareq.hasCredentials())) {
    await vitareq.requestCredentials()
  }

  const issueKey = req?.context?.extension?.issue?.key
    ?? req?.context?.extension?.issueKey
    ?? req?.context?.issue?.key;

  if (!issueKey) {
    console.error('Issue key not available in context');
    return { error: 'Issue key unavailable' };
  }

  const url = `/api/requirements?jiraKey=${encodeURIComponent(issueKey)}`;

  const response = await vitareq.fetch(url, {
    headers: { Accept: 'application/json' },
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Vitareq API error', response.status, errorBody, 'IssueKey:', issueKey);
    return { error: `Error fetching requirements (${response.status})` };
  }

  if (contentType.includes('application/json')) {
    const data = await response.json();
    // Determine the requirement object from common response shapes
    let requirement = null;
    if (Array.isArray(data)) {
      requirement = data[0] ?? null;
    } else if (Array.isArray(data?.requirements)) {
      requirement = data.requirements[0] ?? null;
    } else if (data && typeof data === 'object') {
      requirement = data;
    }

    if (requirement) {
      console.log('Requirement payload resolved:', requirement);
      return requirement;
    }

    console.log('No requirement object found in response');
    return { error: 'No requirement found' };
  }

  const text = await response.text();
  console.log('Non-JSON response received');
  return { error: 'Unexpected non-JSON response', raw: text };
})

export const handler = resolver.getDefinitions();
