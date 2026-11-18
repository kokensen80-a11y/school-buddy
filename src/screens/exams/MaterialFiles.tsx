import { useEffect, useRef, useState } from 'react';
import { File as FileIcon, FileText, Paperclip, Trash2, X } from 'lucide-react';
import { Button, IconButton, Section, Skeleton, Stack, Text, useConfirm, useToast } from '../../components/ui';
import { actions } from '../../lib/store';
import type { Exam } from '../../types';

/** "450 kB", "2,3 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

const isImage = (mime: string) => mime.startsWith('image/');
/** Files a browser shows itself; everything else is downloaded with its own name. */
const isViewable = (mime: string) => isImage(mime) || mime === 'application/pdf' || mime.startsWith('text/');

function kindLabel(name: string, mime: string): string {
  if (isImage(mime)) return 'Foto';
  const ext = name.split('.').pop()?.toUpperCase();
  if (mime === 'application/pdf' || ext === 'PDF') return 'PDF';
  return ext && ext.length <= 5 && ext !== name.toUpperCase() ? ext : 'Bestand';
}

interface FileItem {
  key: string;
  name: string;
  mime: string;
  size: number;
  url?: string;
}

/** Thumbnails for photos, rows for the other files, each with a remove button. */
function FileGrid({
  items,
  onRemove,
  removeLabel,
}: {
  items: FileItem[];
  onRemove: (key: string) => void;
  removeLabel: (name: string) => string;
}) {
  const images = items.filter((f) => isImage(f.mime));
  const others = items.filter((f) => !isImage(f.mime));
  return (
    <Stack gap={3}>
      {images.length > 0 && (
        <div className="sb-exam-photos">
          {images.map((f) => (
            <div key={f.key} className="sb-exam-photo">
              {f.url ? (
                <a href={f.url} target="_blank" rel="noreferrer" aria-label={`${f.name} openen`}>
                  <img src={f.url} alt="" />
                </a>
              ) : (
                <Skeleton shape="card" width="100%" height="100%" />
              )}
              <button
                type="button"
                className="sb-exam-photo__remove"
                aria-label={removeLabel(f.name)}
                onClick={() => onRemove(f.key)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {others.map((f) => (
        <div key={f.key} className="sb-file">
          <span className="sb-file__icon" aria-hidden>
            {kindLabel(f.name, f.mime) === 'PDF' ? <FileText size={18} /> : <FileIcon size={18} />}
          </span>
          {f.url ? (
            <a
              className="sb-file__name"
              href={f.url}
              target="_blank"
              rel="noreferrer"
              download={isViewable(f.mime) ? undefined : f.name}
            >
              <Text as="span" weight="medium" truncate>{f.name}</Text>
              <Text as="span" size="sm" tone="secondary">
                {kindLabel(f.name, f.mime)} · {formatSize(f.size)}
              </Text>
            </a>
          ) : (
            <span className="sb-file__name">
              <Text as="span" weight="medium" truncate>{f.name}</Text>
              <Text as="span" size="sm" tone="secondary">
                {kindLabel(f.name, f.mime)} · {formatSize(f.size)}
              </Text>
            </span>
          )}
          <IconButton aria-label={removeLabel(f.name)} size="sm" variant="plain" onClick={() => onRemove(f.key)}>
            <Trash2 />
          </IconButton>
        </div>
      ))}
    </Stack>
  );
}

function PickButton({ onPick, label = 'Bestand toevoegen', loading }: { onPick: (files: File[]) => void; label?: string; loading?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" variant="secondary" icon={<Paperclip size={16} />} loading={loading} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) onPick(files);
        }}
      />
    </>
  );
}

const HINT = 'Samenvattingen, collegeslides, de studiehandleiding of foto’s uit je boek. Ze blijven op je apparaat.';

/** Files picked while adding a new exam; they are stored when the exam is saved. */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [urls, setUrls] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    const map = new Map(files.map((f) => [f, URL.createObjectURL(f)] as const));
    setUrls(map);
    return () => map.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const items: FileItem[] = files.map((f, i) => ({
    key: String(i),
    name: f.name,
    mime: f.type || 'application/octet-stream',
    size: f.size,
    url: urls.get(f),
  }));
  return (
    <Section label="Bestanden over de stof">
      <Stack gap={3}>
        {files.length === 0 && (
          <Text tone="secondary" size="md">
            {HINT}
          </Text>
        )}
        <FileGrid
          items={items}
          removeLabel={(n) => `${n} weghalen`}
          onRemove={(key) => onChange(files.filter((_, i) => String(i) !== key))}
        />
        <div>
          <PickButton onPick={(picked) => onChange([...files, ...picked])} />
        </div>
      </Stack>
    </Section>
  );
}

/** The files stored with an exam: open, add and remove. */
export function ExamFiles({ exam }: { exam: Exam }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const key = exam.attachments.map((a) => a.id).join(',');

  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all(
      exam.attachments.map(async (a) => {
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

  const add = async (files: File[]) => {
    setBusy(true);
    let added = 0;
    for (const file of files) {
      const result = await actions.addAttachment(exam.id, file);
      if (result.ok) added++;
      else toast.error(`${file.name}: ${result.error}`);
    }
    setBusy(false);
    if (added > 0) toast.success(added === 1 ? 'Bestand toegevoegd.' : `${added} bestanden toegevoegd.`);
  };

  const remove = async (id: string) => {
    const file = exam.attachments.find((a) => a.id === id);
    if (!file) return;
    const ok = await confirm({
      title: 'Bestand verwijderen?',
      message: `${file.name} wordt van dit apparaat verwijderd.`,
      confirmLabel: 'Verwijderen',
      destructive: true,
    });
    if (!ok) return;
    const result = await actions.removeAttachment(exam.id, id);
    if (!result.ok) toast.error(result.error);
  };

  const items: FileItem[] = exam.attachments.map((a) => ({ key: a.id, name: a.name, mime: a.mime, size: a.size, url: urls[a.id] }));
  return (
    <Section label="Bestanden over de stof">
      <Stack gap={3}>
        {items.length === 0 && (
          <Text tone="secondary" size="md">
            {HINT}
          </Text>
        )}
        <FileGrid items={items} removeLabel={(n) => `${n} verwijderen`} onRemove={(k) => void remove(k)} />
        <div>
          <PickButton onPick={(files) => void add(files)} loading={busy} />
        </div>
      </Stack>
    </Section>
  );
}
