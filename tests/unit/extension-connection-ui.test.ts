import { describe, expect, it } from 'vitest';

import {
  disconnectedMenuHint,
  saveMenuTitle,
} from '../../extension/connection-ui';

describe('extension connection menu copy', () => {
  it('labels the save menu by connection state', () => {
    expect(saveMenuTitle(true)).toBe('保存到 Keel');
    expect(saveMenuTitle(false)).toBe('保存到 Keel（未连接）');
  });

  it('explains how to reconnect when offline', () => {
    expect(disconnectedMenuHint()).toContain('Keel');
  });
});
