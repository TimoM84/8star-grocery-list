/** Server-side messages in the household language (`Settings.language`). */

import type { DB } from './db';
import { readSettings } from './settings';
import { messagesFor, type Messages } from '$lib/shared/i18n';

export function householdMessages(db: DB): Messages {
	return messagesFor(readSettings(db).language);
}
