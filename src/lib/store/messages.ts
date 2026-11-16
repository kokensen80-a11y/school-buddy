/** Every error sentence the store can return. Dutch, informal, short. */
import {
  MAX_ATTACHMENT_MB,
  MAX_EXAM_WEIGHT,
  MAX_TOPIC_MINUTES,
  MIN_PASSWORD_LENGTH,
} from './limits';
import { BackendError, type BackendErrorCode, type Failure } from './types';

export const MESSAGES = {
  unknown: 'Er ging iets mis. Probeer het nog een keer.',
  notSignedIn: 'Je bent niet ingelogd.',

  nameRequired: 'Vul je naam in.',
  emailInvalid: 'Vul een geldig e-mailadres in.',
  passwordTooShort: `Kies een wachtwoord van minimaal ${MIN_PASSWORD_LENGTH} tekens.`,
  accountDataLeftBehind:
    'Je account is verwijderd, maar niet al je bestanden konden van dit apparaat worden gewist.',

  subjectNameRequired: 'Geef het vak een naam.',
  subjectNameTaken: 'Je hebt al een vak met deze naam.',
  subjectNotFound: 'Dit vak bestaat niet meer.',
  subjectInUse: 'Dit vak wordt nog gebruikt door een toets. Verwijder of verplaats die toets eerst.',

  examNotFound: 'Deze toets bestaat niet meer.',
  examTitleRequired: 'Geef je toets een naam.',
  examSubjectRequired: 'Kies een vak voor deze toets.',
  dateInvalid: 'Kies een geldige datum.',
  timeInvalid: 'Kies een geldige tijd.',
  weightInvalid: `De weging moet groter dan 0 zijn en mag maximaal ${MAX_EXAM_WEIGHT} zijn.`,
  gradeInvalid: 'Een cijfer ligt tussen 1 en 10.',

  topicNotFound: 'Dit onderdeel bestaat niet meer.',
  topicTitleRequired: 'Geef elk onderdeel van de leerstof een naam.',
  topicMinutesInvalid: `Vul per onderdeel een geschatte tijd in tussen 1 en ${MAX_TOPIC_MINUTES} minuten.`,

  attachmentTooLarge: `Dit bestand is te groot. Een bijlage mag maximaal ${MAX_ATTACHMENT_MB} MB zijn.`,

  sessionNotFound: 'Dit studieblok bestaat niet meer.',

  importInvalid: 'Dit bestand is geen geldige back-up van School Buddy.',
  importTooNew: 'Deze back-up komt uit een nieuwere versie van School Buddy. Werk de app eerst bij.',
} as const;

const BACKEND_MESSAGES: Record<BackendErrorCode, string> = {
  'email-taken': 'Er is al een account met dit e-mailadres.',
  'invalid-credentials': 'Je e-mailadres of wachtwoord klopt niet.',
  'wrong-password': 'Dat wachtwoord klopt niet.',
  'account-not-found': 'Dit account bestaat niet meer.',
  'storage-full':
    'De opslag van je browser is vol. Verwijder een paar bijlagen of oude toetsen en probeer het opnieuw.',
  'storage-unavailable':
    'Opslaan lukt niet in deze browser. Zit je in een privévenster? Probeer het dan in een gewoon venster.',
  'crypto-unavailable':
    'Je wachtwoord kan hier niet veilig worden verwerkt. Open School Buddy via https.',
};

export const fail = (error: string): Failure => ({ ok: false, error });

/** The friendly sentence for anything a backend (or a bug) threw. */
export function describeError(error: unknown): string {
  return error instanceof BackendError ? BACKEND_MESSAGES[error.code] : MESSAGES.unknown;
}
