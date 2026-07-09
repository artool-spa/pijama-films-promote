import { describe, it, expect } from 'vitest';
import {
  MuviImageAssetSchema,
  MuviContentListResponseSchema,
  MuviContentListEnvelopeSchema,
} from '../types';

describe('MuviImageAssetSchema', () => {
  it('accepts null fields (image record present but empty)', () => {
    const result = MuviImageAssetSchema.safeParse({
      file_uuid: 'abc',
      file_name: null,
      file_url: null,
      image_uuid: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('MuviContentListResponseSchema', () => {
  // Regression: a cast member's image record with all-null fields used to throw
  // MuviValidationError and crash the campaign-creation page.
  it('accepts a details response where cast_image_details has all-null fields', () => {
    const response = {
      code: 200,
      status: 'SUCCESS',
      message: 'OK',
      data: {
        contentList: {
          page_info: { total_count: 1 },
          content_list: [
            {
              content_uuid: 'df79bd9ffa854636bc04e70ed83a0e14',
              content_name: 'Test Film',
              cast_details: [
                {
                  cast_uuid: 'cast-1',
                  cast_name: 'Jane Doe',
                  cast_image_uuid: null,
                  cast_image_details: {
                    file_uuid: 'file-1',
                    file_name: null,
                    file_url: null,
                    image_uuid: null,
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const result = MuviContentListResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });
});

describe('MuviContentListEnvelopeSchema', () => {
  it('parses a payload whose item fails the strict item schema', () => {
    // content_asset_type as an unexpected object would fail the strict schema,
    // but the envelope treats items as opaque records.
    const response = {
      code: 200,
      status: 'SUCCESS',
      data: {
        contentList: {
          page_info: { total_count: 1 },
          content_list: [
            {
              content_uuid: 'abc',
              content_name: 'Test',
              content_asset_type: { unexpected: 'shape' },
            },
          ],
        },
      },
    };

    expect(MuviContentListResponseSchema.safeParse(response).success).toBe(false);

    const lenient = MuviContentListEnvelopeSchema.safeParse(response);
    expect(lenient.success).toBe(true);
    if (lenient.success) {
      expect(lenient.data.data.contentList.content_list).toHaveLength(1);
      expect(lenient.data.data.contentList.content_list[0].content_uuid).toBe('abc');
    }
  });

  it('rejects a genuinely malformed response (missing data)', () => {
    const result = MuviContentListEnvelopeSchema.safeParse({
      code: 500,
      status: 'FAILED',
    });
    expect(result.success).toBe(false);
  });
});
