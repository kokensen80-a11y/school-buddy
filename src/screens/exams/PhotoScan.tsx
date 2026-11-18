import { useRef, useState } from 'react';
import { Camera, ScanText } from 'lucide-react';
import { Card, ListRow, ProgressBar, Sheet, Stack, Text, useToast } from '../../components/ui';
import { scanExamText, type ScanResult } from '../../lib/examScan';
import { formatDateShort } from '../../lib/date';
import { useSubjects } from '../../lib/store';
import { useToday } from '../../lib/clock';

/** What was filled in, as a short Dutch list: "datum, tijd en vak". */
export function foundSummary(r: ScanResult): string {
  const parts = [
    r.date && 'datum',
    r.time && 'tijd',
    (r.subjectId || r.subjectName) && 'vak',
    r.location && 'lokaal',
  ].filter(Boolean) as string[];
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} en ${parts[parts.length - 1]}`;
}

/**
 * "Scan een foto" card: reads a photo or screenshot and hands the exam details to `onResult`.
 * With a whole toetsrooster on the photo it first asks which exam to use.
 */
export function PhotoScan({ onResult }: { onResult: (result: ScanResult, photo: File) => void }) {
  const subjects = useSubjects();
  const today = useToday();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ value: number; step: string } | null>(null);
  const [choices, setChoices] = useState<{ results: ScanResult[]; photo: File } | null>(null);

  const scan = async (photo: File) => {
    setProgress({ value: 0, step: 'Foto voorbereiden' });
    try {
      const { recognizeText } = await import('../../lib/ocr');
      const text = await recognizeText(photo, (value, step) => setProgress({ value, step }));
      const results = scanExamText(text, { today, subjects });
      if (results.length === 0) {
        toast.error('Op deze foto vond ik geen datum of vak. Vul de toets zelf in.');
      } else if (results.length === 1) {
        onResult(results[0], photo);
      } else {
        setChoices({ results, photo });
      }
    } catch {
      toast.error('De foto kon niet gelezen worden. Controleer je internet en probeer het opnieuw.');
    } finally {
      setProgress(null);
    }
  };

  const subjectLabel = (r: ScanResult) =>
    subjects.find((s) => s.id === r.subjectId)?.name ?? r.subjectName ?? 'Onbekend vak';

  return (
    <>
      <Card className="sb-scan">
        {progress ? (
          <Stack gap={3} aria-live="polite">
            <Stack direction="row" gap={3} align="center">
              <ScanText size={20} aria-hidden />
              <Text weight="semibold">{progress.step}…</Text>
            </Stack>
            <ProgressBar value={progress.value} aria-label="Voortgang van het lezen" />
            <Text size="sm" tone="secondary">
              De eerste keer duurt dit wat langer. Je foto blijft op je apparaat.
            </Text>
          </Stack>
        ) : (
          <button type="button" className="sb-scan__button" onClick={() => input.current?.click()}>
            <span className="sb-scan__icon" aria-hidden>
              <Camera size={20} />
            </span>
            <span className="sb-scan__text">
              <Text as="span" weight="semibold">Foto van je toets</Text>
              <Text as="span" size="sm" tone="secondary">
                Ik lees de datum, tijd, het vak en lokaal voor je uit.
              </Text>
            </span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void scan(file);
          }}
        />
      </Card>

      <Sheet open={choices !== null} onClose={() => setChoices(null)} title="Welke toets bedoel je?" showClose>
        <Stack gap={2}>
          <Text tone="secondary" size="md">
            Ik zag {choices?.results.length} toetsen op de foto. Kies er een; de rest kun je daarna los toevoegen.
          </Text>
          {choices?.results.map((r, i) => (
            <ListRow
              key={i}
              title={subjectLabel(r)}
              subtitle={[r.date && formatDateShort(r.date), r.time, r.location].filter(Boolean).join(' · ') || r.context}
              chevron
              onClick={() => {
                const photo = choices.photo;
                setChoices(null);
                onResult(r, photo);
              }}
            />
          ))}
        </Stack>
      </Sheet>
    </>
  );
}
