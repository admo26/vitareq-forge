import api from '@forge/api';
import { kvs } from '@forge/kvs';

function redactProps(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (/secret|password|token/i.test(key)) {
      if (typeof value === 'string') {
        out[key] = value.length > 4 ? `${value.slice(0, 2)}***${value.slice(-2)}` : '***';
      } else {
        out[key] = '[redacted]';
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function onConnectionChange(event) {
  try {
    const rootKeys = Object.keys(event || {});
    const payloadKeys = Object.keys(event?.payload || {});
    const body = event?.payload?.body ?? event?.body ?? event?.payload ?? event ?? {};
    const action = body?.action;
    const name = body?.name;
    const dataSourceId = body?.dataSourceId ?? body?.datasourceId;
    const configProperties = body?.configProperties || {};
    console.log('[connector.onConnectionChange]', {
      rootKeys,
      payloadKeys,
      action,
      name,
      dataSourceId,
      hasProps: Object.keys(configProperties).length > 0,
      bodyKeys: Object.keys(body || {}),
      configProperties: redactProps(configProperties),
    });
    // Persist or delete credentials per action
    try {
      if (action === 'CREATED' || action === 'UPDATED') {
        const id = String(dataSourceId || name || 'default');
        if (configProperties?.clientId) {
          await kvs.setSecret(`vitareq:${id}:clientId`, String(configProperties.clientId));
          await kvs.setSecret(`vitareq:active:clientId`, String(configProperties.clientId));
        }
        if (configProperties?.clientSecret) {
          await kvs.setSecret(`vitareq:${id}:clientSecret`, String(configProperties.clientSecret));
          await kvs.setSecret(`vitareq:active:clientSecret`, String(configProperties.clientSecret));
        }
        console.log('[connector.onConnectionChange] credentials stored for', id);
      } else if (action === 'DELETED') {
        const id = String(dataSourceId || name || 'default');
        await kvs.deleteSecret(`vitareq:${id}:clientId`);
        await kvs.deleteSecret(`vitareq:${id}:clientSecret`);
        await kvs.deleteSecret(`vitareq:active:clientId`);
        await kvs.deleteSecret(`vitareq:active:clientSecret`);
        console.log('[connector.onConnectionChange] credentials deleted for', id);
      }
    } catch (e) {
      console.error('[connector.onConnectionChange] kvs error', e?.message || e);
    }
    return { ok: true };
  } catch (e) {
    console.error('[connector.onConnectionChange] error', e?.message || e, e?.stack);
    return { ok: false };
  }
}

export async function validateConnection(event) {
  try {
    const rootKeys = Object.keys(event || {});
    const payloadKeys = Object.keys(event?.payload || {});
    const body = event?.payload?.body ?? event?.body ?? event?.payload ?? event ?? {};
    const name = body?.name;
    const props = body?.configProperties || {};
    console.log('[connector.validateConnection] payload', { rootKeys, payloadKeys, name, keys: Object.keys(props), bodyKeys: Object.keys(body || {}), configProperties: redactProps(props) });

    const clientId = String(props.clientId || '').trim();
    const clientSecret = String(props.clientSecret || '').trim();
    if (!clientId) {
      throw new Error('Client ID is required');
    }
    if (!clientSecret) {
      throw new Error('Client Secret is required');
    }

    // Optionally: perform a lightweight token request to validate creds
    // Skipped here to avoid external side effects during validation
    return { ok: true };
  } catch (e) {
    console.error('[connector.validateConnection] error', e?.message || e, e?.stack);
    throw new Error(e?.message || 'Validation failed');
  }
}


