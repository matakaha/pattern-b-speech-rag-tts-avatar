import { z } from 'zod';

export const DocumentManifestSchema = z.object({
  documents: z
    .array(
      z.object({
        path: z.string().min(1),
        title: z.string().min(1),
        sourceUrl: z.string().url().startsWith('https://'),
        acl: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

export type DocumentManifest = z.infer<typeof DocumentManifestSchema>;
