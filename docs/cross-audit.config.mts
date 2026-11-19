import { mergeConfig } from 'vitest/config';
import base from '../vite.config';
export default mergeConfig(base, { test: { include: ['docs/cross-audit.probe.ts'] } });
