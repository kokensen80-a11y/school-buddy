import { useEffect, useState } from 'react';
import { Section } from '../../components/ui';
import { actions } from '../../lib/store';
import type { AttachmentMeta } from '../../types';

/** The photos stored with an exam, as thumbnails that open full size. */
export function ExamPhotos({ attachments }: { attachments: AttachmentMeta[] }) {
  const images = attachments.filter((a) => a.mime.startsWith('image/'));
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = images.map((a) => a.id).join(',');

  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all(
      images.map(async (a) => {
        const blob = await actions.getAttachmentBlob(a.id);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        made.push(url);
        return [a.id, url] as const;
      }),
    ).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs.filter((p) => p !== null)));
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (images.length === 0) return null;
  return (
    <Section label={images.length === 1 ? 'Foto' : "Foto's"}>
      <div className="sb-exam-photos">
        {images.map((a) =>
          urls[a.id] ? (
            <a key={a.id} href={urls[a.id]} target="_blank" rel="noreferrer" className="sb-exam-photo">
              <img src={urls[a.id]} alt="Foto van de toets" />
            </a>
          ) : null,
        )}
      </div>
    </Section>
  );
}
