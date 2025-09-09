import api from '@forge/api';

export async function onConnectionChange(event) {
  try {
    const action = event?.payload?.action;
    const name = event?.payload?.name;
    const datasourceId = event?.payload?.datasourceId;
    const configProperties = event?.payload?.configProperties || {};
    console.log('[connector.onConnectionChange]', { action, name, datasourceId, hasProps: Object.keys(configProperties).length > 0 });
    return { ok: true };
  } catch (e) {
    console.error('[connector.onConnectionChange] error', e?.message || e, e?.stack);
    return { ok: false };
  }
}

export async function validateConnection(event) {
  try {
    const name = event?.payload?.name;
    const props = event?.payload?.configProperties || {};
    console.log('[connector.validateConnection] payload', { name, keys: Object.keys(props) });

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


