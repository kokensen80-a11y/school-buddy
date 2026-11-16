import { useEffect, useRef } from 'react';
import { CalendarDays, GraduationCap, House, UserRound } from 'lucide-react';
import { TabBar, type TabBarItem } from '../components/ui';
import { useInbox } from '../lib/store';
import { isTabRoot, navigate, tabOf, useRoute, type Route, type TabName } from '../lib/router';
import { unreadCount } from '../lib/selectors';
import { useBackgroundWork } from './useBackgroundWork';
import HomeScreen from '../screens/home/HomeScreen';
import InboxScreen from '../screens/inbox/InboxScreen';
import AgendaScreen from '../screens/agenda/AgendaScreen';
import ExamsScreen from '../screens/exams/ExamsScreen';
import ExamDetailScreen from '../screens/exams/ExamDetailScreen';
import ExamEditScreen from '../screens/exams/ExamEditScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import PreferencesScreen from '../screens/profile/PreferencesScreen';
import NotificationSettingsScreen from '../screens/profile/NotificationSettingsScreen';

const TITLES: Record<Route['name'], string> = {
  home: 'Home',
  agenda: 'Agenda',
  toetsen: 'Toetsen',
  'toets-nieuw': 'Nieuwe toets',
  toets: 'Toets',
  'toets-bewerken': 'Toets bewerken',
  profiel: 'Profiel',
  voorkeuren: 'Studievoorkeuren',
  'meldingen-instellingen': 'Herinneringen',
  meldingen: 'Meldingen',
};

/** The signed-in app: one screen per route, with the tab bar on the four tab screens. */
export default function MainShell() {
  useBackgroundWork();
  const route = useRoute();
  const tab = tabOf(route);
  const unread = unreadCount(useInbox());
  const mainRef = useRef<HTMLDivElement>(null);
  const key = 'id' in route ? `${route.name}:${route.id}` : route.name;

  useEffect(() => {
    document.title = `${TITLES[route.name]} · School Buddy`;
    mainRef.current?.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }, [key, route.name]);

  const tabs: ReadonlyArray<TabBarItem<TabName>> = [
    { key: 'home', label: 'Home', icon: <House />, badge: unread },
    { key: 'agenda', label: 'Agenda', icon: <CalendarDays /> },
    { key: 'toetsen', label: 'Toetsen', icon: <GraduationCap /> },
    { key: 'profiel', label: 'Profiel', icon: <UserRound /> },
  ];

  return (
    <div ref={mainRef} className="sb-shell">
      <RouteScreen key={key} route={route} />
      {isTabRoot(route) && (
        <TabBar aria-label="Hoofdmenu" items={tabs} value={tab} onChange={(k) => navigate({ name: k })} />
      )}
    </div>
  );
}

function RouteScreen({ route }: { route: Route }) {
  switch (route.name) {
    case 'agenda':
      return <AgendaScreen date={route.date} />;
    case 'toetsen':
      return <ExamsScreen />;
    case 'toets-nieuw':
      return <ExamEditScreen />;
    case 'toets':
      return <ExamDetailScreen examId={route.id} />;
    case 'toets-bewerken':
      return <ExamEditScreen examId={route.id} />;
    case 'profiel':
      return <ProfileScreen />;
    case 'voorkeuren':
      return <PreferencesScreen />;
    case 'meldingen-instellingen':
      return <NotificationSettingsScreen />;
    case 'meldingen':
      return <InboxScreen />;
    default:
      return <HomeScreen />;
  }
}
