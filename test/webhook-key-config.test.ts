import './support/test-env.js';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertWebhookKeyConfigured } from '@gaian-stellar-integration/config';

describe('webhook internal key config', () => {
  it('throws when the webhook is enabled and the key is empty', () => {
    assert.throws(
      () =>
        assertWebhookKeyConfigured({
          GAIAN_WEBHOOK_ENABLED: true,
          GAIAN_WEBHOOK_INTERNAL_API_KEY: '',
        }),
      /GAIAN_WEBHOOK_INTERNAL_API_KEY/,
    );
  });

  it('accepts an empty key while the webhook is disabled', () => {
    assert.doesNotThrow(() =>
      assertWebhookKeyConfigured({
        GAIAN_WEBHOOK_ENABLED: false,
        GAIAN_WEBHOOK_INTERNAL_API_KEY: '',
      }),
    );
  });

  it('accepts a key while the webhook is enabled', () => {
    assert.doesNotThrow(() =>
      assertWebhookKeyConfigured({
        GAIAN_WEBHOOK_ENABLED: true,
        GAIAN_WEBHOOK_INTERNAL_API_KEY: 'test-only-fake',
      }),
    );
  });
});
