import { it } from 'vitest';
import { environmentReviewCases } from './support/environmentReviewCases.js';

it.each(environmentReviewCases)('$name', async ({ run }) => run());
