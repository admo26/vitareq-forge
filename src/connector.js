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

const KVS_KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/;
function validateKvsKey(key) {
  const isValid = KVS_KEY_PATTERN.test(String(key || ''));
  console.log('[connector.kvs] key validation', { key, isValid });
  return isValid;
}

export async function onConnectionChange(event) {
  try {
    // Log raw payload (unredacted for testing)
    try {
      console.log('[connector.onConnectionChange] raw event preview', {
        eventType: typeof event,
        rootKeys: Object.keys(event || {}),
        payloadKeys: Object.keys(event?.payload || {}),
        payload: event?.payload,
        body: event?.payload?.body ?? event?.body,
      });
    } catch (_) {
      // ignore logging errors
    }
    const rootKeys = Object.keys(event || {});
    const payloadKeys = Object.keys(event?.payload || {});
    const body = event?.payload?.body ?? event?.body ?? event?.payload ?? event ?? {};
    const action = body?.action;
    const name = body?.name;
    const dataSourceId = body?.dataSourceId ?? body?.datasourceId;
    const configProperties = body?.configProperties || {};
    console.log('[connector.onConnectionChange]', { action, name, dataSourceId });
    // Persist or delete credentials per action
    try {
      if (action === 'CREATED' || action === 'UPDATED') {
        const id = String(dataSourceId || name || 'default');
        const clientIdKey = `vitareq:${id}:clientId`;
        const clientSecretKey = `vitareq:${id}:clientSecret`;
        const connectionIdKey = `vitareq:${id}:connectionId`;
        const activeClientIdKey = 'vitareq:active:clientId';
        const activeClientSecretKey = 'vitareq:active:clientSecret';
        const activeConnectionIdKey = 'vitareq:active:connectionId';
        const connectionId = String(body?.connectionId ?? body?.connection?.id ?? event?.connectionId ?? '').trim();
        console.log('[connector.onConnectionChange] computed kvs keys', { id, clientIdKey, clientSecretKey, connectionIdKey, activeClientIdKey, activeClientSecretKey, activeConnectionIdKey, connectionId });

        if (configProperties?.clientId) {
          validateKvsKey(clientIdKey);
          validateKvsKey(activeClientIdKey);
          await kvs.setSecret(clientIdKey, String(configProperties.clientId));
          await kvs.setSecret(activeClientIdKey, String(configProperties.clientId));
        }
        if (configProperties?.clientSecret) {
          validateKvsKey(clientSecretKey);
          validateKvsKey(activeClientSecretKey);
          await kvs.setSecret(clientSecretKey, String(configProperties.clientSecret));
          await kvs.setSecret(activeClientSecretKey, String(configProperties.clientSecret));
        }
        if (connectionId) {
          validateKvsKey(connectionIdKey);
          validateKvsKey(activeConnectionIdKey);
          await kvs.setSecret(connectionIdKey, connectionId);
          await kvs.setSecret(activeConnectionIdKey, connectionId);
        }
        console.log('[connector.onConnectionChange] credentials stored for', id);
      } else if (action === 'DELETED') {
        const id = String(dataSourceId || name || 'default');
        const clientIdKey = `vitareq:${id}:clientId`;
        const clientSecretKey = `vitareq:${id}:clientSecret`;
        const connectionIdKey = `vitareq:${id}:connectionId`;
        const activeClientIdKey = 'vitareq:active:clientId';
        const activeClientSecretKey = 'vitareq:active:clientSecret';
        const activeConnectionIdKey = 'vitareq:active:connectionId';
        console.log('[connector.onConnectionChange] deleting kvs keys', { id, clientIdKey, clientSecretKey, connectionIdKey, activeClientIdKey, activeClientSecretKey, activeConnectionIdKey });
        validateKvsKey(clientIdKey);
        validateKvsKey(clientSecretKey);
        validateKvsKey(connectionIdKey);
        validateKvsKey(activeClientIdKey);
        validateKvsKey(activeClientSecretKey);
        validateKvsKey(activeConnectionIdKey);
        await kvs.deleteSecret(clientIdKey);
        await kvs.deleteSecret(clientSecretKey);
        await kvs.deleteSecret(connectionIdKey);
        await kvs.deleteSecret(activeClientIdKey);
        await kvs.deleteSecret(activeClientSecretKey);
        await kvs.deleteSecret(activeConnectionIdKey);
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
    // Log raw payload (unredacted for testing)
    try {
      console.log('[connector.validateConnection] raw event preview', {
        eventType: typeof event,
        rootKeys: Object.keys(event || {}),
        payloadKeys: Object.keys(event?.payload || {}),
        payload: event?.payload,
        body: event?.payload?.body ?? event?.body,
      });
    } catch (_) {
      // ignore logging errors
    }
    const rootKeys = Object.keys(event || {});
    const payloadKeys = Object.keys(event?.payload || {});
    const body = event?.payload?.body ?? event?.body ?? event?.payload ?? event ?? {};
    const name = body?.name;
    const props = body?.configProperties || {};
    console.log('[connector.validateConnection] payload', { name });

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


