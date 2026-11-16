import { describe, expect, it, vi } from 'vitest';
import { House, UserRound } from 'lucide-react';
import { SUBJECT_COLOR_ORDER, SUBJECT_COLORS } from '../../lib/labels';
import { initialsOf } from './Avatar';
import {
  ActionTile,
  ActionTileRow,
  Avatar,
  Badge,
  Button,
  Card,
  CheckCircle,
  Chip,
  ChoiceChip,
  DateInput,
  Field,
  IconButton,
  LargeHeader,
  ListRow,
  ProgressBar,
  ProgressRing,
  Screen,
  Section,
  SegmentedControl,
  Select,
  Slider,
  Stepper,
  SubjectTag,
  Switch,
  TabBar,
  TextArea,
  TextInput,
  TimeInput,
  TopBar,
  resolveColor,
} from './index';
import {
  changeValue,
  click,
  listProjectDir,
  pressKey,
  query,
  readProjectFile,
  referencedText,
  render,
  rerender,
} from './testing';

describe('design tokens', () => {
  const tokens = readProjectFile('src/styles/tokens.css');

  it('defines every subject colour with the hex value from SUBJECT_COLORS', () => {
    for (const name of SUBJECT_COLOR_ORDER) {
      const match = new RegExp(`--subject-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(tokens);
      expect(match?.[1].toLowerCase(), name).toBe(SUBJECT_COLORS[name].hex.toLowerCase());
    }
  });

  it('is light only', () => {
    expect(tokens).toMatch(/color-scheme:\s*light;/);
  });

  it('prefixes every class of the kit with "sb-"', () => {
    const folder = 'src/components/ui';
    const sheets = listProjectDir(folder).filter((file) => file.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(20);
    for (const file of [...sheets.map((name) => `${folder}/${name}`), 'src/styles/utilities.css']) {
      const css = readProjectFile(file).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.length, file).toBeGreaterThan(0);
      const classes = [...css.matchAll(/(?<![\w)\]])\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
      expect(classes.filter((name) => !name.startsWith('sb-')), file).toEqual([]);
    }
  });
});

describe('resolveColor', () => {
  it('maps subject colour names to the palette and passes other colours through', () => {
    expect(resolveColor('blue')).toBe('var(--subject-blue)');
    expect(resolveColor('#123456')).toBe('#123456');
    expect(resolveColor('toString')).toBe('toString');
  });
});

describe('Button', () => {
  it('is a plain button by default and reports presses', () => {
    const onClick = vi.fn();
    const container = render(<Button onClick={onClick}>Opslaan</Button>);
    const button = query<HTMLButtonElement>(container, 'button');
    expect(button.type).toBe('button');
    expect(button.textContent).toContain('Opslaan');
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ignores presses while loading, but stays focusable', () => {
    const onClick = vi.fn();
    const container = render(
      <Button loading onClick={onClick}>
        Opslaan
      </Button>,
    );
    const button = query<HTMLButtonElement>(container, 'button');
    click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(false);
  });

  it('does not submit a form while loading', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const container = render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Opslaan
        </Button>
      </form>,
    );
    click(query(container, 'button'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('applies variant, size and block classes', () => {
    const container = render(
      <Button variant="danger" size="lg" block>
        Verwijderen
      </Button>,
    );
    expect(query(container, 'button').className).toBe(
      'sb-button sb-button--danger sb-button--lg sb-button--block',
    );
  });
});

describe('IconButton', () => {
  it('adds the badge count to the accessible name', () => {
    const container = render(
      <IconButton aria-label="Meldingen" badge={3}>
        <House />
      </IconButton>,
    );
    expect(query(container, 'button').getAttribute('aria-label')).toBe('Meldingen (3)');
  });
});

describe('ActionTile', () => {
  it('renders equal tiles with a label and reports presses', () => {
    const onClick = vi.fn();
    const container = render(
      <ActionTileRow>
        <ActionTile variant="primary" icon={<House />} label="Inplannen" onClick={onClick} />
        <ActionTile icon={<House />} label="Meer" />
      </ActionTileRow>,
    );
    const tiles = container.querySelectorAll('button');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].className).toContain('sb-action-tile--primary');
    expect(tiles[1].className).toContain('sb-action-tile--secondary');
    click(tiles[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('TopBar and LargeHeader', () => {
  it('shows a labelled back button, the title and the actions', () => {
    const onBack = vi.fn();
    const onEdit = vi.fn();
    const container = render(
      <TopBar
        title="Biologie"
        onBack={onBack}
        actions={[{ icon: <House />, label: 'Bewerken', onClick: onEdit }]}
      />,
    );
    expect(query(container, 'h1').textContent).toBe('Biologie');
    click(query(container, 'button[aria-label="Terug"]'));
    click(query(container, 'button[aria-label="Bewerken"]'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('leaves out the back button and the pill when they are not needed', () => {
    const container = render(<TopBar title="Voorkeuren" />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('.sb-glass-pill')).toBeNull();
  });

  it('renders a large title with subtitle', () => {
    const container = render(<LargeHeader title="Vandaag" subtitle="maandag 16 november" />);
    expect(query(container, 'h1').textContent).toBe('Vandaag');
    expect(container.textContent).toContain('maandag 16 november');
  });
});

describe('Screen', () => {
  it('renders the ambient background, the top bar slot and the content', () => {
    const container = render(
      <Screen tint="blue" withTabBar topBar={<TopBar title="Toets" />}>
        <p>Inhoud</p>
      </Screen>,
    );
    const screen = query(container, '.sb-screen');
    expect(screen.className).toContain('sb-screen--top-bar');
    expect(screen.className).toContain('sb-screen--tab-bar');
    expect(query(container, '.sb-ambient').style.getPropertyValue('--sb-ambient-tint')).toBe(
      'var(--subject-blue)',
    );
    expect(query(container, 'main').textContent).toBe('Inhoud');
    expect(query(container, 'header h1').textContent).toBe('Toets');
  });
});

describe('TabBar', () => {
  const items = [
    { key: 'home', label: 'Home', icon: <House /> },
    { key: 'profiel', label: 'Profiel', icon: <UserRound />, badge: 2 },
  ] as const;

  it('is a navigation landmark that marks the active tab', () => {
    const container = render(<TabBar items={items} value="home" onChange={() => undefined} />);
    expect(query(container, 'nav').getAttribute('aria-label')).toBe('Hoofdmenu');
    const tabs = container.querySelectorAll('button');
    expect(tabs[0].getAttribute('aria-current')).toBe('page');
    expect(tabs[1].hasAttribute('aria-current')).toBe(false);
    expect(tabs[1].getAttribute('aria-label')).toBe('Profiel (2)');
  });

  it('reports the key of the pressed tab', () => {
    const onChange = vi.fn();
    const container = render(<TabBar items={items} value="home" onChange={onChange} />);
    click(container.querySelectorAll('button')[1]);
    expect(onChange).toHaveBeenCalledWith('profiel');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'gespreid', label: 'Gelijkmatig' },
    { value: 'vroeg', label: 'Ruim op tijd' },
    { value: 'laat', label: 'Kort van tevoren' },
  ];

  it('is a radio group with a roving tab stop', () => {
    const container = render(
      <SegmentedControl
        aria-label="Planstijl"
        options={options}
        value="vroeg"
        onChange={() => undefined}
      />,
    );
    expect(query(container, '[role="radiogroup"]').getAttribute('aria-label')).toBe('Planstijl');
    const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const checked = radios.map((radio) => radio.getAttribute('aria-checked'));
    expect(checked).toEqual(['false', 'true', 'false']);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves the choice with the arrow keys, Home and End, wrapping around', () => {
    const onChange = vi.fn();
    const container = render(
      <SegmentedControl aria-label="Planstijl" options={options} value="laat" onChange={onChange} />,
    );
    const group = query(container, '[role="radiogroup"]');
    const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    pressKey(radios[2], 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('gespreid');
    expect(document.activeElement).toBe(radios[0]);
    pressKey(group, 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('vroeg');
    pressKey(group, 'Home');
    expect(onChange).toHaveBeenLastCalledWith('gespreid');
    onChange.mockClear();
    pressKey(group, 'End');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    const container = render(
      <SegmentedControl
        aria-label="Planstijl"
        options={options}
        value="gespreid"
        onChange={onChange}
      />,
    );
    click(container.querySelectorAll('[role="radio"]')[1]);
    expect(onChange).toHaveBeenCalledWith('vroeg');
  });
});

describe('toggles', () => {
  it('Switch reports the flipped state', () => {
    const onChange = vi.fn();
    const container = render(<Switch checked={false} onChange={onChange} aria-label="Meldingen" />);
    const control = query(container, '[role="switch"]');
    expect(control.getAttribute('aria-checked')).toBe('false');
    click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('CheckCircle is a real checkbox', () => {
    const onChange = vi.fn();
    const container = render(
      <CheckCircle checked={false} onChange={onChange} aria-label="Blok afvinken" />,
    );
    const box = query<HTMLInputElement>(container, 'input[type="checkbox"]');
    expect(box.getAttribute('aria-label')).toBe('Blok afvinken');
    click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ChoiceChip is a toggle button', () => {
    const onChange = vi.fn();
    const container = render(
      <ChoiceChip selected onChange={onChange}>
        Flashcards
      </ChoiceChip>,
    );
    const chip = query(container, 'button');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    click(chip);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('Stepper', () => {
  it('steps, formats and clamps to min and max', () => {
    const onChange = vi.fn();
    const container = render(
      <Stepper
        aria-label="Blokken"
        value={25}
        onChange={onChange}
        min={5}
        max={30}
        step={10}
        format={(value) => `${value} min`}
      />,
    );
    const [minus, plus] = container.querySelectorAll('button');
    expect(query(container, 'output').textContent).toBe('25 min');
    expect(minus.getAttribute('aria-label')).toBe('Minder');
    expect(plus.getAttribute('aria-label')).toBe('Meer');
    click(plus);
    expect(onChange).toHaveBeenLastCalledWith(30);
    click(minus);
    expect(onChange).toHaveBeenLastCalledWith(15);
  });

  it('disables a button at its bound', () => {
    const container = render(
      <Stepper aria-label="Dagen" value={1} onChange={() => undefined} min={1} max={3} />,
    );
    const [minus, plus] = container.querySelectorAll('button');
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(false);
  });

  it('keeps fractional steps free of rounding noise', () => {
    const onChange = vi.fn();
    const container = render(
      <Stepper aria-label="Weging" value={0.2} onChange={onChange} step={0.1} />,
    );
    click(container.querySelectorAll('button')[1]);
    expect(onChange).toHaveBeenCalledWith(0.3);
  });
});

describe('Slider', () => {
  it('reports numbers and describes the value in words', () => {
    const onChange = vi.fn();
    const container = render(
      <Slider
        aria-label="Leertijd"
        value={60}
        onChange={onChange}
        max={240}
        step={15}
        format={(value) => `${value} min`}
      />,
    );
    const input = query<HTMLInputElement>(container, 'input[type="range"]');
    expect(input.getAttribute('aria-valuetext')).toBe('60 min');
    expect(query(container, 'output').textContent).toBe('60 min');
    changeValue(input, '90');
    expect(onChange).toHaveBeenCalledWith(90);
  });
});

describe('Field', () => {
  it('connects the label, the hint and the control', () => {
    const container = render(
      <Field label="Titel" hint="Bijvoorbeeld hoofdstuk 3">
        <TextInput value="" onChange={() => undefined} />
      </Field>,
    );
    const input = query<HTMLInputElement>(container, 'input');
    const label = query<HTMLLabelElement>(container, 'label');
    expect(label.htmlFor).toBe(input.id);
    expect(input.id).not.toBe('');
    expect(referencedText(input, 'aria-describedby')).toBe('Bijvoorbeeld hoofdstuk 3');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows the error instead of the hint and marks the control invalid', () => {
    const container = render(
      <Field label="Titel" hint="Bijvoorbeeld hoofdstuk 3" error="Vul een titel in.">
        <TextInput value="" onChange={() => undefined} />
      </Field>,
    );
    const input = query(container, 'input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(referencedText(input, 'aria-describedby')).toBe('Vul een titel in.');
    expect(container.textContent).not.toContain('Bijvoorbeeld');
  });

  it('labels a group of controls and names a segmented control', () => {
    const container = render(
      <Field label="Moeilijkheid" group>
        <SegmentedControl
          options={[
            { value: 1, label: 'Makkelijk' },
            { value: 2, label: 'Gemiddeld' },
          ]}
          value={1}
          onChange={() => undefined}
        />
      </Field>,
    );
    const group = query(container, '[role="group"]');
    expect(referencedText(group, 'aria-labelledby')).toBe('Moeilijkheid');
    expect(container.querySelector('label')).toBeNull();
    const radioGroup = query(container, '[role="radiogroup"]');
    expect(referencedText(radioGroup, 'aria-labelledby')).toBe('Moeilijkheid');
  });

  it('works with every native control of the kit', () => {
    const container = render(
      <>
        <Field label="Soort">
          <Select value="" onChange={() => undefined} options={[{ value: 'toets', label: 'Toets' }]} />
        </Field>
        <Field label="Notities">
          <TextArea value="" onChange={() => undefined} />
        </Field>
        <Field label="Meldingen">
          <Switch checked onChange={() => undefined} />
        </Field>
      </>,
    );
    for (const label of container.querySelectorAll('label')) {
      expect(document.getElementById(label.htmlFor), label.textContent ?? '').not.toBeNull();
    }
    expect(container.querySelectorAll('label')).toHaveLength(3);
  });
});

describe('text-like inputs', () => {
  it('report plain values', () => {
    const onText = vi.fn();
    const onDate = vi.fn();
    const onTime = vi.fn();
    const onSelect = vi.fn();
    const container = render(
      <>
        <TextInput aria-label="Titel" value="" onChange={onText} />
        <DateInput aria-label="Datum" value="" onChange={onDate} />
        <TimeInput aria-label="Tijd" value="" onChange={onTime} />
        <Select
          aria-label="Soort"
          value=""
          onChange={onSelect}
          placeholder="Kies een soort"
          options={[
            { value: 'toets', label: 'Toets' },
            { value: 'so', label: 'SO' },
          ]}
        />
      </>,
    );
    changeValue(query(container, 'input[aria-label="Titel"]'), 'Hoofdstuk 3');
    changeValue(query(container, 'input[type="date"]'), '2026-11-26');
    changeValue(query(container, 'input[type="time"]'), '10:15');
    changeValue(query(container, 'select'), 'so');
    expect(onText).toHaveBeenCalledWith('Hoofdstuk 3');
    expect(onDate).toHaveBeenCalledWith('2026-11-26');
    expect(onTime).toHaveBeenCalledWith('10:15');
    expect(onSelect).toHaveBeenCalledWith('so');
  });

  it('Select offers a placeholder that cannot be chosen', () => {
    const container = render(
      <Select
        aria-label="Soort"
        value=""
        onChange={() => undefined}
        placeholder="Kies een soort"
        options={[{ value: 'toets', label: 'Toets' }]}
      />,
    );
    const placeholder = query<HTMLOptionElement>(container, 'option');
    expect(placeholder.textContent).toBe('Kies een soort');
    expect(placeholder.disabled).toBe(true);
    expect(query(container, 'select').className).toContain('sb-select__control--placeholder');
  });
});

describe('ListRow', () => {
  it('keeps a control in a slot separate from the row press', () => {
    const onRow = vi.fn();
    const onCheck = vi.fn();
    const container = render(
      <ListRow
        title="§3.1 Mitose"
        subtitle="Samenvatten · 30 min"
        leading={<CheckCircle checked={false} onChange={onCheck} aria-label="Afvinken" />}
        onClick={onRow}
      />,
    );
    click(query(container, 'input[type="checkbox"]'));
    expect(onCheck).toHaveBeenCalledWith(true);
    expect(onRow).not.toHaveBeenCalled();
    const rowButton = query(container, 'button.sb-list-row__main');
    expect(rowButton.textContent).toBe('§3.1 MitoseSamenvatten · 30 min');
    click(rowButton);
    expect(onRow).toHaveBeenCalledTimes(1);
  });

  it('is static without onClick and toggles its control as a label', () => {
    const onChange = vi.fn();
    const container = render(
      <ListRow
        asLabel
        title="Herinneringen"
        trailing={<Switch checked={false} onChange={onChange} />}
      />,
    );
    expect(container.querySelector('button.sb-list-row__main')).toBeNull();
    click(query(container, '.sb-list-row__title'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Card and Section', () => {
  it('Card is a button only when it can be pressed', () => {
    const onClick = vi.fn();
    const container = render(<Card onClick={onClick}>Biologie</Card>);
    click(query(container, 'button.sb-card'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(container, <Card>Biologie</Card>);
    expect(container.querySelector('button')).toBeNull();
    expect(query(container, 'div.sb-card').textContent).toBe('Biologie');
  });

  it('Section is a region named by its label', () => {
    const container = render(
      <Section label="Leerstof">
        <p>Inhoud</p>
      </Section>,
    );
    expect(referencedText(query(container, 'section'), 'aria-labelledby')).toBe('Leerstof');
  });
});

describe('small parts', () => {
  it('Badge hides zero and caps large counts', () => {
    const container = render(<Badge count={0} />);
    expect(container.textContent).toBe('');
    rerender(container, <Badge count={120} />);
    expect(container.textContent).toBe('99+');
    rerender(container, <Badge count={7} tone="danger" />);
    expect(query(container, '.sb-badge--danger').textContent).toBe('7');
  });

  it('Chip and SubjectTag show their text and colour', () => {
    const container = render(
      <>
        <Chip color="orange">Moeilijk</Chip>
        <SubjectTag color="blue">Wiskunde</SubjectTag>
      </>,
    );
    const dot = query(container, '.sb-chip__dot');
    const tag = query(container, '.sb-subject-tag');
    expect(dot.style.getPropertyValue('--sb-dot-color')).toBe('var(--subject-orange)');
    expect(tag.style.getPropertyValue('--sb-subject-color')).toBe('var(--subject-blue)');
    expect(container.textContent).toBe('MoeilijkWiskunde');
  });

  it('progress indicators expose a clamped percentage', () => {
    const container = render(
      <>
        <ProgressBar value={0.426} aria-label="Voortgang" />
        <ProgressRing value={7} aria-label="Ring" />
        <ProgressBar value={Number.NaN} aria-label="Leeg" />
      </>,
    );
    const values = [...container.querySelectorAll('[role="progressbar"]')].map((bar) =>
      bar.getAttribute('aria-valuenow'),
    );
    expect(values).toEqual(['43', '100', '0']);
  });

  it('Avatar derives initials from the name', () => {
    expect(initialsOf('Sanne de Vries')).toBe('SV');
    expect(initialsOf('  noor ')).toBe('N');
    expect(initialsOf('')).toBe('?');
    const container = render(<Avatar name="Sanne de Vries" />);
    expect(query(container, '[role="img"]').getAttribute('aria-label')).toBe('Sanne de Vries');
    expect(container.textContent).toBe('SV');
  });
});
