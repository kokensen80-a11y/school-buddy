import { Bell, BookOpen, CalendarDays, Moon, Settings } from 'lucide-react';
import {
  Card,
  EmptyState,
  ListRow,
  Screen,
  Section,
  Stack,
  TopBar,
  useConfirm,
  useToast,
} from '../../components/ui';
import { actions, useInbox } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { addDays, formatDateShort, toISODate } from '../../lib/date';
import { goBack, navigate } from '../../lib/router';
import type { InboxItem, ReminderKind } from '../../types';
import { CheckCheck, Trash } from 'lucide-react';

const ICONS: Record<ReminderKind, typeof Bell> = {
  sessie: BookOpen,
  toets: CalendarDays,
  dagoverzicht: Bell,
  avondcheck: Moon,
  systeem: Settings,
};

/** The in-app notification centre: every reminder that fired. */
export default function InboxScreen() {
  const inbox = useInbox();
  const today = useToday();
  const toast = useToast();
  const confirm = useConfirm();
  const unread = inbox.some((i) => !i.read);

  const groups: Array<[string, InboxItem[]]> = [
    ['Vandaag', []],
    ['Gisteren', []],
    ['Eerder', []],
  ];
  for (const item of inbox) {
    const day = toISODate(new Date(item.at));
    groups[day === today ? 0 : day === addDays(today, -1) ? 1 : 2][1].push(item);
  }

  const open = (item: InboxItem) => {
    if (!item.read) void actions.markInboxRead(item.id);
    if (item.link) window.location.hash = item.link;
  };

  const clear = async () => {
    const ok = await confirm({ title: 'Alle meldingen wissen?', confirmLabel: 'Wissen', destructive: true });
    if (!ok) return;
    const result = await actions.clearInbox();
    if (!result.ok) toast.error(result.error);
  };

  const topActions = [
    ...(unread ? [{ key: 'read', icon: <CheckCheck />, label: 'Alles gelezen', onClick: () => void actions.markInboxRead('all') }] : []),
    ...(inbox.length ? [{ key: 'clear', icon: <Trash />, label: 'Wissen', onClick: () => void clear() }] : []),
  ];

  return (
    <Screen topBar={<TopBar title="Meldingen" onBack={() => goBack({ name: 'home' })} actions={topActions} />}>
      {inbox.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="Nog geen meldingen"
          text="Je ziet hier je herinneringen terug."
        />
      ) : (
        <Stack gap={6}>
          {groups
            .filter(([, items]) => items.length > 0)
            .map(([label, items]) => (
              <Section key={label} label={label}>
                <Card padding="none">
                  {items.map((item) => {
                    const Icon = ICONS[item.kind] ?? Bell;
                    const time = new Date(item.at);
                    const when = `${label === 'Eerder' ? formatDateShort(toISODate(time)) + ' ' : ''}${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
                    return (
                      <ListRow
                        key={item.id}
                        className={item.read ? undefined : 'sb-inbox-unread'}
                        leading={<Icon size={20} />}
                        title={item.title}
                        subtitle={item.body}
                        trailing={when}
                        onClick={() => open(item)}
                      />
                    );
                  })}
                </Card>
              </Section>
            ))}
        </Stack>
      )}
      <Stack gap={2}>
        <Card padding="none">
          <ListRow title="Instellingen voor herinneringen" chevron onClick={() => navigate({ name: 'meldingen-instellingen' })} />
        </Card>
      </Stack>
    </Screen>
  );
}
