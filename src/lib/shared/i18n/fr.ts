/** French. */

import type { Messages } from './en';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const fr: Messages = {
	seeded: {
		lists: { default: 'Courses' },
		categories: {
			'cat-groente': 'Fruits & légumes',
			'cat-brood': 'Pain & viennoiseries',
			'cat-zuivel': 'Produits laitiers & œufs',
			'cat-kaas': 'Fromage & charcuterie',
			'cat-vlees': 'Viande, poisson & végé',
			'cat-houdbaar': 'Épicerie',
			'cat-diepvries': 'Surgelés',
			'cat-dranken': 'Boissons',
			'cat-snacks': 'Snacks & sucreries',
			'cat-verzorging': 'Hygiène & soins',
			'cat-huishouden': 'Entretien'
		}
	},
	units: {
		stuks: 'pièce',
		pak: 'paquet',
		fles: 'bouteille',
		blik: 'boîte',
		zak: 'sachet',
		bos: 'botte',
		doos: 'carton',
		pot: 'pot'
	},
	unitsPlural: {
		stuks: 'pièces',
		pak: 'paquets',
		fles: 'bouteilles',
		blik: 'boîtes',
		zak: 'sachets',
		bos: 'bottes',
		doos: 'cartons',
		pot: 'pots'
	},
	time: {
		today: 'aujourd’hui',
		yesterday: 'hier',
		tomorrow: 'demain',
		todayHeading: 'Aujourd’hui',
		yesterdayHeading: 'Hier',
		daysAgo: (n) => `il y a ${n} jours`,
		inDays: (n) => `dans ${n} jours`,
		everyDay: 'tous les jours',
		everyDays: (n) => `tous les ${n} jours`,
		everyWeeks: (n) => `toutes les ${n} semaines`,
		everyMonths: (n) => `tous les ${n} mois`,
		perMonth: (v) => `${v}× par mois`,
		never: 'jamais',
		justNow: 'à l’instant',
		minutesAgo: (n) => `il y a ${n} min`,
		hoursAgo: (n) => `il y a ${n} h`
	},
	common: {
		quote: (s) => `« ${s} »`,
		cancel: 'Annuler',
		close: 'Fermer',
		save: 'Enregistrer',
		delete: 'Supprimer',
		remove: 'Retirer',
		add: 'Ajouter',
		back: 'Retour',
		edit: 'Modifier',
		done: 'Terminé',
		undo: 'Annuler',
		undoUnavailable: 'Il n’est plus possible d’annuler.',
		dismissNotice: 'Fermer la notification',
		favorite: 'Favori',
		favoriteSr: 'favori',
		less: 'Moins',
		more: 'Plus',
		none: 'aucune',
		list: 'liste',
		thisList: 'cette liste',
		otherList: 'une autre liste',
		item: 'Article',
		product: 'Produit',
		unknownProduct: 'Produit inconnu',
		someoneElse: 'Quelqu’un d’autre',
		and: ' et '
	},
	shell: {
		title: '8star Courses',
		description: 'Liste de courses partagée pour tout le foyer.',
		updateReady: 'Nouvelle version disponible',
		update: 'Mettre à jour',
		loading: 'Chargement de la liste…',
		offlineNoData:
			'Pas de connexion et pas encore de données sur cet appareil. Connectez-vous au réseau domestique ou au VPN.'
	},
	nav: {
		label: 'Navigation principale',
		list: 'Liste',
		suggestions: 'Suggestions',
		shortcuts: 'Raccourcis',
		history: 'Historique',
		settings: 'Gestion',
		suggestionCount: (n) => plural(n, 'suggestion', 'suggestions')
	},
	syncBadge: {
		offline: 'Hors ligne',
		syncing: 'Sync…',
		connecting: 'Connexion',
		live: 'Live',
		offlineTitle: (n) =>
			`Pas de connexion au serveur. ${plural(n, 'modification attend', 'modifications attendent')} et ${n === 1 ? 'sera envoyée' : 'seront envoyées'} automatiquement.`,
		onlineTitle: 'Connecté : les modifications sont partagées immédiatement.',
		syncingTitle: 'Synchronisation en cours.'
	},
	sort: {
		label: 'Tri',
		newest: 'Récents ↓',
		newestHint: 'Derniers ajoutés en haut',
		oldest: 'Anciens ↑',
		oldestHint: 'Premiers ajoutés en haut',
		az: 'A–Z',
		azHint: 'Alphabétique'
	},
	stock: {
		label: (name) => `Stock ${name}`,
		enough: 'Suffisant',
		low: 'Presque fini',
		out: 'Épuisé',
		unknown: 'Inconnu',
		updated: (ago) => `Mis à jour ${ago}`,
		stale: ' · peut-être obsolète'
	},
	category: {
		label: 'Catégorie',
		none: 'Sans catégorie'
	},
	quantity: {
		label: 'Quantité',
		less: 'Moins',
		more: 'Plus',
		clear: 'Effacer',
		unit: 'Unité',
		noUnit: 'aucune',
		moreUnits: 'Plus d’unités'
	},
	photo: {
		title: 'Photo',
		alt: (name) => `Photo de ${name}`,
		unavailable:
			'Photo indisponible. Sans connexion, seules les photos déjà vues peuvent être affichées.',
		waiting: 'Pas encore partagée : elle sera envoyée dès qu’il y aura une connexion.',
		rejectedSheet: 'Le serveur a refusé cette photo. Voir Gestion → Synchronisation.',
		field: 'Photo (une par produit)',
		enlarge: 'Agrandir la photo',
		take: 'Prendre une photo',
		retake: 'Nouvelle photo',
		pick: 'Choisir un fichier',
		replace: 'Remplacer',
		remove: 'Retirer',
		shrinking: 'Réduction de la photo…',
		rejected: 'Cette photo a été refusée. Choisissez une autre photo.',
		removeTitle: 'Retirer la photo ?',
		removeMessage: 'La photo est retirée de ce produit. Vous pouvez annuler tout de suite.',
		tooLarge: 'Cette photo est trop grande.',
		wrongType: 'Choisissez une photo (JPEG, PNG ou WebP).',
		unreadable: 'Cette photo est illisible.',
		cannotProcess: 'Le traitement des photos ne fonctionne pas sur cet appareil.',
		addFailed: 'L’ajout de la photo a échoué.',
		serverRejected: (status) => `Photo refusée (HTTP ${status}).`
	},
	addBar: {
		firstLineOnly: 'Seule la première ligne a été collée : « Ajouter plusieurs » est désactivé.',
		placeholder: 'De quoi a-t-on besoin ?',
		add: 'Ajouter',
		earlier: 'Produits précédents',
		onList: 'sur la liste',
		on: (lists) => `sur ${lists}`,
		ticked: 'coché',
		putBack: 'remettre',
		bought: (n) => `acheté ${n}×`
	},
	itemRow: {
		you: 'Vous vous en chargez',
		claimedBy: (name) => `${name} s’en charge`,
		putBack: (name) => `Remettre ${name} sur la liste`,
		tick: (name) => `Cocher ${name}`,
		isNew: 'Nouveau',
		unavailable: 'Indisponible',
		bought: (q) => `${q} acheté`,
		substitute: 'Autre marque OK',
		viewPhoto: (name) => `Voir la photo de ${name}`,
		moreActions: (name) => `Plus d’actions pour ${name}`,
		edit: (name) => `Modifier ${name}`
	},
	productRow: {
		theList: 'la liste',
		isOn: (name, list) => `${name} est sur ${list}`,
		putOn: (name, list) => `Mettre ${name} sur ${list}`
	},
	toast: {
		datasetReplaced:
			'Les données ont été remplacées par une importation ou une restauration. Votre liste a été mise à jour.',
		opFailed: 'La modification n’a pas pu être traitée.',
		suggestionsOn: 'Les suggestions sont affichées sur tous les appareils',
		suggestionsOff: 'Suggestions masquées sur tous les appareils. Rien n’a été supprimé.',
		bulkAddOn: '« Ajouter plusieurs » est affiché sur tous les appareils',
		bulkAddOff:
			'« Ajouter plusieurs » masqué sur tous les appareils. Ajouter un produit fonctionne toujours.',
		languageChanged: (name) => `Langue changée en ${name} sur tous les appareils`,
		addedTo: (label, list) => `${label} ajouté à ${list}`,
		backOnList: (label) => `${label} est de retour sur la liste`,
		addedUsual: (label) => `${label} ajouté avec la quantité habituelle`,
		extra: (name, amount) => `« ${name} » : ${amount} en plus`,
		changedTo: (name, amount) => `« ${name} » changé en ${amount}`,
		noQuantity: 'sans quantité',
		manyAdded: (n) => `${n} ajoutés`,
		manyIncreased: (n) => `${n} augmentés`,
		manyChanged: (n) => `${n} modifiés`,
		listFallback: 'Liste',
		ticked: (name) => `« ${name} » coché`,
		stockEnough: 'Mettre le stock à suffisant',
		partial: (name, got, left) => `« ${name} » : ${got} acheté, ${left} reste sur la liste`,
		unavailable: (name) => `« ${name} » indisponible : toujours nécessaire`,
		availableAgain: (name) => `« ${name} » de nouveau à acheter`,
		retryUnavailable: 'Les produits indisponibles sont de nouveau à acheter',
		deleted: (name) => `« ${name} » supprimé`,
		moved: (name, list) => `« ${name} » déplacé vers ${list}`,
		clearedCompleted: 'Articles cochés retirés',
		nameInUse: (name) => `Le nom « ${name} » est déjà utilisé.`,
		unfavorited: (name) => `« ${name} » n’est plus un favori`,
		favorited: (name) => `« ${name} » est un favori`,
		productDeleted: (name) => `« ${name} » et son historique supprimés`,
		aliasOwn: (alias) => `« ${alias} » appartient déjà à ce produit.`,
		aliasTaken: (alias, owner) =>
			`« ${alias} » est déjà utilisé pour « ${owner} ». Les produits ne sont jamais fusionnés automatiquement.`,
		anotherProduct: 'un autre produit',
		aliasRemoved: 'Autre nom retiré',
		stockSet: (name, status) => `Stock « ${name} » : ${status}`,
		stockStatus: { unknown: 'inconnu', enough: 'suffisant', low: 'presque fini', out: 'épuisé' },
		photoSaved: (name) => `Photo de « ${name} » enregistrée`,
		photoQueued: (name) =>
			`Photo de « ${name} » conservée ; elle sera partagée dès qu’il y aura une connexion`,
		photoRemoved: (name) => `Photo de « ${name} » retirée`,
		snoozed: (name, until) => `« ${name} » ne sera pas suggéré avant ${until}`,
		bundleExists: (name) => `Un lot « ${name} » existe déjà.`,
		bundleSaved: (name) => `Lot « ${name} » enregistré`,
		bundleCopy: (name, n) => (n === 1 ? `${name} (copie)` : `${name} (copie ${n})`),
		bundleDeleted: (name) => `Lot « ${name} » supprimé (les produits et l’historique restent)`,
		roundEnded: 'Tournée de courses terminée. Rien n’a été coché ni enregistré.',
		listExists: (name) => `Une liste « ${name} » existe déjà.`,
		nowChecklist: (name) =>
			`« ${name} » est maintenant une checklist. Cocher ne compte plus comme un achat ; l’historique est conservé.`,
		nowGrocery: (name) =>
			`« ${name} » est maintenant une liste de courses. Désormais, cocher compte comme un achat.`,
		checklistReset: (n) => `${plural(n, 'tâche remise', 'tâches remises')} à faire`,
		listDeleted: (name) => `Liste « ${name} » supprimée`,
		categoryExists: (name) => `Une catégorie « ${name} » existe déjà.`,
		categoryDeleted: (name) => `Catégorie « ${name} » supprimée`,
		recAlreadyOnList: (name) => `« ${name} » était déjà sur la liste — suggestion terminée`,
		recAdded: (name) => `« ${name} » mis sur la liste`,
		recDismissed: (name) => `Suggestion IA pour « ${name} » écartée`,
		productFallback: 'produit'
	},
	sync: {
		refused: (detail) => `Modification refusée par le serveur : ${detail}`,
		noAnswer: 'Pas de réponse du serveur pour cette modification.'
	},
	addPrompt: {
		titleExists: (name) => `« ${name} » est déjà sur la liste`,
		titleElsewhere: (name, lists) => `« ${name} » est sur ${lists}`,
		existing: 'Déjà sur la liste :',
		existingNoQty: 'Déjà sur la liste, sans quantité.',
		incompatible: (q) =>
			`Vous avez saisi ${q}. C’est une autre unité, les quantités ne peuvent donc pas être additionnées.`,
		unknownExisting: 'La quantité sur la liste est inconnue, rien n’est donc additionné.',
		notCountable: 'Saisissez une quantité à ajouter (p. ex. « 500 g »).',
		oneExtra: 'Un de plus',
		extra: (q) => `${q} en plus`,
		setTo: (q) => `Changer en ${q}`,
		choose: 'Choisir la quantité',
		keep: 'Laisser tel quel',
		on: 'Sur',
		whatToDo: 'Que voulez-vous faire ?',
		alsoOn: (list) => `Mettre aussi sur ${list}`,
		moveTo: (list) => `Déplacer vers ${list}`
	},
	ai: {
		title: 'Suggestions IA',
		intro:
			'D’un fichier IA externe (p. ex. ChatGPT). Indépendant des prévisions propres ; rien n’est jamais mis sur la liste automatiquement.',
		likely: 'estimation : probable',
		possible: 'estimation : possible',
		uncertain: 'estimation : incertain',
		importLabel: 'Suggestions IA (JSON)',
		importHint:
			'Un fichier au format "8star-ai-recommendations" (voir Gestion → Données → Consigne IA).',
		onList: 'sur la liste',
		sourceFallback: 'Fichier IA',
		expected: (when) => `Besoin prévu : ${when}`,
		confidence: (pct) =>
			`Confiance indiquée ${pct} % — une estimation de l’outil IA, pas une certitude.`,
		imported: (date) => `Importé ${date}`,
		why: 'Pourquoi ?',
		complete: 'Terminer',
		dismiss: 'Écarter',
		empty: 'Aucune suggestion IA ouverte.',
		importOpen: 'Importer un fichier IA',
		howTo: 'Comment créer un tel fichier ?'
	},
	bulk: {
		title: 'Ajouter plusieurs',
		check: 'Vérifier',
		onePerLine: 'Un produit par ligne',
		placeholder: '2 kg pommes de terre\nlait\n- fromage, doux',
		help: (max) =>
			`Les puces sont retirées. Les virgules font partie du nom. Les quantités comme « 2 kg » ou « x3 » sont reconnues. ${max} lignes au maximum.`,
		shared:
			'Partagé depuis une autre application. Rien n’a encore été ajouté : vérifiez la liste ci-dessous.',
		linksIgnored: 'Les liens ne sont ni ouverts ni lus.',
		addTo: 'Ajouter à',
		truncated: (max, n) =>
			`Seulement les ${max} premières lignes ; ${plural(n, 'ligne ignorée', 'lignes ignorées')}.`,
		noLines: 'Aucune ligne trouvée.',
		include: (n) => `Inclure la ligne ${n}`,
		line: (n) => `Ligne ${n}`,
		whatToDo: (name) => `Que faire de ${name}`,
		noName: 'Pas de nom de produit',
		tooLong: (max) => `Plus de ${max} caractères`,
		duplicate: (n) => `Doublon : aussi à la ligne ${n}`,
		alsoOn: (lists) => `aussi sur ${lists}`,
		onList: 'Déjà sur la liste',
		onListQty: (q) => `Déjà sur la liste : ${q}`,
		backOnList: 'De retour sur la liste',
		known: 'Produit connu',
		new: 'Nouveau produit',
		blocking: (n) =>
			n === 1
				? 'Corrigez la ligne rouge ou décochez-la.'
				: `Corrigez les ${n} lignes rouges ou décochez-les.`,
		submit: (n) => `Traiter ${plural(n, 'produit', 'produits')}`
	},
	bundle: {
		bundle: 'Lot',
		addTitle: (name) => `Ajouter ${name}`,
		servings: 'Personnes',
		fewer: 'Moins de personnes',
		more: 'Plus de personnes',
		scaled: (factor, servings) => `Quantités × ${factor} (recette pour ${servings}).`,
		untickOwned: 'Décochez ce que vous avez déjà à la maison.',
		include: (name) => `Ajouter ${name}`,
		rounded: (exact) => `Exactement ${exact} : arrondi au-dessus, à vérifier.`,
		deleteTitle: (name) => `Supprimer le lot « ${name} » ?`,
		deleteMessage:
			'Seul le lot est supprimé. Les produits, les listes et l’historique sont conservés.',
		editTitle: 'Modifier le lot',
		newTitle: 'Nouveau lot',
		name: 'Nom',
		namePlaceholder: 'p. ex. Lasagnes ou Base de la semaine',
		servingsLabel: 'Pour combien de personnes (facultatif)',
		servingsHelp: 'Vous pourrez alors choisir le nombre de personnes à l’ajout.',
		lines: 'Produits (un par ligne)',
		linePlaceholder: 'p. ex. 500 g de viande hachée',
		lineLabel: (n) => `Produit ${n}`,
		removeLine: (n) => `Retirer la ligne ${n}`,
		addLine: 'Ajouter une ligne',
		copy: 'Copier'
	},
	importPanel: {
		kind: 'Type de fichier',
		offlineHint: 'L’importation ne fonctionne qu’avec une connexion au serveur.',
		choose: 'Choisir un fichier',
		busy: 'En cours…',
		import: 'Importer',
		merge: 'Fusionner',
		replaceAll: 'Tout remplacer',
		mergeHelp:
			'ajoute seulement les nouvelles données ; les données existantes restent inchangées.',
		replaceHelp:
			'remet le serveur exactement dans l’état de ce fichier (après une sauvegarde automatique).',
		another: 'Importer un autre fichier',
		pending: (n) =>
			`${plural(n, 'modification attend', 'modifications attendent')} encore d’être envoyées. Connectez-vous d’abord, puis réessayez.`,
		replaceTitle: 'Remplacer toutes les données ?',
		replaceMessage: (summary) =>
			`${summary}. Toutes les listes, tous les produits et tout l’historique actuels du serveur sont remplacés par ce fichier, pour tous les appareils. Une sauvegarde est d’abord faite automatiquement sur le serveur.`,
		fileTooLarge: (mb) => `Le fichier dépasse ${mb} Mo.`,
		serverTooLarge: 'Le fichier est trop volumineux pour le serveur.',
		serverRefused: (status) => `Le serveur a refusé l’importation (HTTP ${status}).`,
		offline: 'Pas de connexion au serveur. L’importation ne fonctionne qu’en ligne.'
	},
	importReport: {
		rejected: 'Importation refusée',
		previewReplace: 'Aperçu : tout remplacer',
		preview: 'Aperçu',
		done: 'Importation terminée',
		backup: (file) => `Sauvegarde préalable : ${file}`,
		errors: 'Erreurs',
		warnings: 'À noter',
		showAll: (n) => `Afficher les ${n}`
	},
	itemSheet: {
		deleteTitle: (name) => `Supprimer « ${name} » ?`,
		deleteMessage: 'L’article est retiré de cette liste. L’historique d’achat est conservé.',
		partial: 'Acheté en partie',
		unavailable: 'Indisponible',
		availableAgain: 'De nouveau à acheter',
		claimTakeOver: (name) => `${name} s’en charge · reprendre`,
		release: 'Ne plus s’en charger',
		claim: 'Je m’en charge',
		partialQuestion: (q) => `Combien de ${q} avez-vous ?`,
		partialQty: 'Quantité achetée',
		partialResult: (got, left) => `${got} est enregistré comme acheté, ${left} reste sur la liste.`,
		partialAll: 'Tout acheté : l’article sera coché.',
		name: 'Nom',
		note: 'Note pour cette fois',
		notePlaceholder: 'p. ex. pour samedi',
		noteHelp: 'Disparaît quand le produit est de nouveau nécessaire plus tard.',
		substitute: 'Une autre marque ou un autre produit convient',
		yes: 'Oui',
		no: 'Non',
		substitutePlaceholder: 'Précisions (facultatif), p. ex. bio de préférence',
		substituteLabel: 'Précisions sur une autre marque',
		moreOptions: 'Plus d’options',
		moreOptionsHint: 'note fixe, photo, catégorie, liste',
		productNote: 'Note fixe du produit',
		productNotePlaceholder: 'p. ex. sans sel',
		productNoteHelp: 'Conservée, aussi pour les prochaines fois.',
		markFavorite: 'Marquer comme favori',
		list: 'Liste',
		openProduct: 'Produit, historique et stock',
		removeFromList: 'Retirer de la liste'
	},
	listSettings: {
		toChecklistTitle: (name) => `Faire de « ${name} » une checklist ?`,
		toGroceryTitle: (name) => `Faire de « ${name} » une liste de courses ?`,
		toChecklistMessage:
			'Cocher ne compte alors plus comme achat, stock ou prévision. L’historique d’achat existant est conservé.',
		toGroceryMessage:
			'Désormais, cocher compte comme un achat et alimente les prévisions. Les coches précédentes de la checklist ne comptent pas.',
		toChecklist: 'Faire une checklist',
		toGrocery: 'Faire une liste de courses',
		kind: (name) => `Type de liste ${name}`,
		grocery: 'Courses',
		checklist: 'Checklist',
		route: 'Parcours',
		customOrder: 'ordre personnalisé',
		defaultOrder: 'par défaut',
		routeHelp: 'Ordre des catégories pour « Par catégorie » dans ce magasin.',
		earlier: (name) => `${name} plus tôt`,
		later: (name) => `${name} plus tard`,
		useDefault: 'Utiliser l’ordre par défaut',
		checklistHelp: 'Ordre fixe, « À faire » et « Fait ». Ne compte pas comme un achat.'
	},
	ordered: {
		newName: 'Nouveau nom',
		rename: (name) => `Renommer ${name}`,
		up: (name) => `Monter ${name}`,
		down: (name) => `Descendre ${name}`,
		remove: (name) => `Supprimer ${name}`
	},
	memory: {
		label: 'Mémoire du produit',
		stock: 'Stock',
		isOn: (list) => `Sur ${list}`,
		putOn: (list) => `Mettre sur ${list}`,
		stockHelp:
			'Seulement ce que vous saisissez vous-mêmes. Rien n’est jamais mis sur la liste automatiquement.',
		usual: 'Quantité habituelle',
		notSet: 'Non définie',
		usualHelp:
			'Utilisée quand vous l’ajoutez sans quantité. Une quantité saisie l’emporte toujours.',
		preferred: 'Va généralement sur',
		noPreferred: 'Pas de liste fixe',
		preferredHelp: 'Détermine sur quelle liste il est suggéré.',
		note: 'Note fixe',
		noteHelp: 'Reste avec le produit, aussi pour les prochaines fois.',
		aliases: 'Autres noms',
		removeAlias: (alias) => `Retirer l’autre nom ${alias}`,
		aliasPlaceholder: 'p. ex. lait demi-écrémé',
		addAlias: 'Ajouter un autre nom',
		aliasHelp:
			'Saisir ou coller ce nom trouve ce produit. Les produits ne sont jamais fusionnés automatiquement.',
		snoozedUntil: (date) => `Pas suggéré avant ${date}`,
		unsnooze: 'Suggérer à nouveau'
	},
	productSheet: {
		deleteTitle: (name) => `Supprimer définitivement « ${name} » ?`,
		deleteMessage: 'Le produit disparaît de toutes les listes, avec tout l’historique d’achat.',
		onList: 'Sur la liste',
		timesBought: 'Fois acheté',
		lastBought: 'Dernier achat',
		avgInterval: 'Intervalle moy.',
		frequency: 'Fréquence',
		next: 'Prochaine fois',
		firstAdded: 'Ajouté la première fois',
		needHistory: (n) => `Après ${n} achats, nous estimons quand vous en aurez de nouveau besoin.`,
		rename: 'Changer le nom',
		history: 'Historique',
		loading: 'Chargement…',
		noHistory: 'Pas encore d’historique.',
		offline: 'Hors ligne : seuls les achats récents sont affichés.',
		bought: 'Acheté',
		removed: 'Retiré de la liste',
		added: (date) => `ajouté ${date}`,
		delete: 'Supprimer le produit et l’historique'
	},
	list: {
		roundRunning: 'Une tournée de courses est en cours',
		roundShopping: (names, n) => `${names} ${n === 1 ? 'fait' : 'font'} les courses`,
		someone: 'Quelqu’un',
		someoneLower: 'quelqu’un',
		endRoundTitle: 'Terminer la tournée de courses ?',
		endRoundMessage:
			'La tournée s’arrête pour tout le monde. Rien n’est coché ni enregistré ; la liste reste telle quelle.',
		endRoundConfirm: 'Terminer',
		clearDoneTitle: 'Retirer les tâches faites ?',
		clearTickedTitle: 'Retirer les articles cochés ?',
		clearMessage: (n) =>
			`${n === 1 ? '1 article disparaît' : `${n} articles disparaissent`} de cette liste.`,
		historyKept: 'L’historique d’achat est conservé.',
		clear: 'Retirer',
		resetTitle: 'Remettre à faire ?',
		resetMessage: (n, names) =>
			`${n === 1 ? 'Cette tâche revient' : `Ces ${n} tâches reviennent`} dans « À faire » : ${names}. Vous pouvez annuler.`,
		andMore: (n) => ` et ${n} de plus`,
		resetConfirm: 'Remettre',
		allDone: 'Tout est fait',
		toDoCount: (n) => `${n} à faire`,
		nothingToGet: 'Rien à acheter',
		toGetCount: (n) => `${plural(n, 'article', 'articles')} à acheter`,
		toDo: 'À faire',
		toGet: 'À acheter',
		done: 'Fait',
		ticked: 'Coché',
		allBought: 'Tout est acheté',
		remaining: (n) => `encore ${plural(n, 'produit', 'produits')}`,
		roundOffline: 'Démarrée hors ligne : la tournée sera partagée dès qu’il y aura une connexion.',
		together: (names) => `Avec ${names}`,
		chooseList: 'Choisir une liste',
		join: 'Rejoindre',
		goShopping: 'Je fais les courses',
		several: 'Plusieurs',
		frozenHelp:
			'L’ordre en mode courses reste figé ; un nouveau tri s’applique à partir de la prochaine fois.',
		endRoundAll: 'Terminer la tournée pour tout le monde',
		newItems: (n) =>
			n === 1 ? '1 nouveau produit sur la liste' : `${n} nouveaux produits sur la liste`,
		view: 'Afficher',
		maybe: 'Peut-être nécessaire',
		all: 'Tout',
		order: 'Ordre',
		display: 'Affichage',
		byCategory: 'Par catégorie',
		emptyChecklist: 'Tout est fait !',
		emptyChecklistHelp: 'Remettez la liste à faire ou saisissez une nouvelle tâche ci-dessus.',
		emptyShopping: 'Tout est acheté !',
		emptyShoppingHelp: 'Touchez Terminé pour quitter le mode courses.',
		empty: 'Rien ne manque !',
		emptyHelp: 'Saisissez ci-dessus ce qui doit aller sur la liste.',
		other: 'Autre',
		tidy: (n) => `Replier les articles cochés (${n})`,
		retry: 'Réessayer',
		unavailableHelp: 'Toujours nécessaire, pas acheté. Reste sur la liste.',
		reset: 'Remettre à faire',
		clearDone: 'Retirer les tâches faites',
		clearTicked: 'Retirer les articles cochés'
	},
	share: {
		title: 'Partager',
		opening: 'Ouverture du texte partagé…',
		bulkOff: '« Ajouter plusieurs » est désactivé : rien n’a été ajouté depuis le texte partagé.'
	},
	suggestions: {
		addTo: (list) => `Ajouter à ${list}`,
		maybeHelp:
			'Selon la fréquence à laquelle vous achetez quelque chose. Rien n’est jamais ajouté automatiquement.',
		none: (n) =>
			`Pas encore de suggestions. Après au moins ${n} achats d’un produit, nous prévoyons quand vous en aurez de nouveau besoin.`,
		last: (when) => `dernier ${when}`,
		expected: (when) => `prévu ${when}`,
		snooze: (name) => `Ne pas suggérer ${name} maintenant`,
		notNow: 'Pas maintenant',
		bundles: 'Lots',
		bundlesHelp:
			'Combinaisons fixes ou recettes. Vous voyez toujours d’abord ce qui va sur la liste.',
		editBundle: (name) => `Modifier le lot ${name}`,
		bundleProducts: (n) => plural(n, 'produit', 'produits'),
		forServings: (n) => `pour ${n}`,
		stockHelp:
			'Ce que vous avez marqué comme presque fini ou épuisé. Réglez le stock depuis un produit (touchez le nom).',
		stockEmpty: 'Rien de marqué comme presque fini.',
		to: (list) => `vers ${list}`,
		editStock: (name) => `Modifier le stock de ${name}`,
		favorites: 'Favoris',
		favoritesEmpty: 'Marquez des produits avec l’étoile pour les retrouver vite ici.',
		onList: 'Sur la liste',
		bought: (n) => `acheté ${n}×`,
		frequent: 'Souvent achetés',
		frequentEmpty: 'Vos produits les plus achetés apparaissent ici.'
	},
	history: {
		productCount: (n) => plural(n, 'produit', 'produits'),
		products: 'Produits',
		purchases: 'Achats',
		search: 'Rechercher tous les produits',
		searchLabel: 'Rechercher',
		clearSearch: 'Effacer la recherche',
		filter: 'Filtre',
		nothingFound: (q) => `Rien trouvé pour « ${q} ».`,
		noProducts: 'Pas encore de produits.',
		notBought: 'Pas encore acheté',
		offline: 'Hors ligne : achats récents de cet appareil.',
		noPurchasesFound: (q) => `Aucun achat trouvé pour « ${q} ».`,
		noPurchases: 'Pas encore d’achats. Cochez des articles pour les voir ici.',
		loadMore: 'Charger plus'
	},
	settings: {
		subtitle: 'Listes, catégories et données',
		listDetail: (active, done) => `${active} à acheter · ${done} cochés`,
		allShared: 'Tout est partagé',
		notShared: (n) =>
			`${plural(n, 'modification pas encore partagée', 'modifications pas encore partagées')}`,
		deleteListTitle: (name) => `Supprimer la liste « ${name} » ?`,
		deleteListMessage:
			'Les articles de cette liste disparaissent. Les produits et l’historique d’achat sont conservés.',
		deleteCategoryTitle: (name) => `Supprimer la catégorie « ${name} » ?`,
		deleteCategoryMessage: 'Les produits de cette catégorie n’auront plus de catégorie.',
		backupMade: (file) => `Sauvegarde faite : ${file}`,
		backupOffline: 'Une sauvegarde ne fonctionne qu’avec une connexion au serveur.',
		connected: 'Connecté (live)',
		connecting: 'Connexion…',
		sync: 'Synchronisation',
		serverNewer:
			'Le serveur utilise une version plus récente. Rechargez l’application pour tout utiliser.',
		photosWaiting: (n) => (n === 1 ? '1 photo en attente' : `${n} photos en attente`),
		pending: 'Modifications en attente',
		lastSync: 'Dernière synchronisation',
		syncHelp:
			'Les modifications sont d’abord enregistrées sur cet appareil et envoyées automatiquement dès que le serveur est de nouveau joignable (réseau domestique ou VPN).',
		syncNow: 'Synchroniser maintenant',
		issues: (n) => `Notifications (${n})`,
		clearAll: 'Tout effacer',
		hideIssue: 'Masquer la notification',
		device: 'Cet appareil',
		deviceNameSet: (name) => `Nom de l’appareil : ${name}`,
		deviceNameCleared: 'Nom de l’appareil effacé',
		deviceName: 'Nom dans la tournée de courses (facultatif)',
		deviceNamePlaceholder: 'p. ex. Sam',
		deviceNameExample: 'Sam',
		deviceNameHelp: (name) =>
			`Les autres voient alors « ${name} fait les courses ». Pas de compte, pas de position : seulement ce nom et un identifiant d’appareil aléatoire.`,
		shareRound: 'Partager la tournée de courses',
		shareRoundHint:
			'Avec « Je fais les courses », les autres voient que vous faites les courses et vous pouvez cocher ensemble.',
		wakeLock: 'Garder l’écran allumé en mode courses',
		wakeLockHint: 'Seulement tant que le mode courses est ouvert et visible.',
		features: 'Fonctions',
		language: 'Langue',
		languageHint:
			'Pour tous les appareils. Les noms de produits, de listes et de catégories que vous avez saisis restent tels quels.',
		suggestions: 'Afficher les suggestions',
		suggestionsHint:
			'« Peut-être nécessaire », suggestions IA, import de fichier IA, consigne IA et le badge de suggestions. La saisie propose toujours les produits correspondants. S’applique à tous les appareils ; désactiver les masque seulement, l’historique et les suggestions sont conservés.',
		bulkAdd: 'Afficher « Ajouter plusieurs »',
		bulkAddHint:
			'Saisir, coller ou partager plusieurs produits à la fois. Ajouter un produit fonctionne toujours. S’applique à tous les appareils.',
		lists: 'Listes',
		listsHelp: 'Chaque liste est indépendante. Touchez un nom pour le renommer.',
		addList: 'Liste',
		newList: 'Nouvelle liste',
		listCreated: (name) => `Liste « ${name} » créée`,
		kindAndRoute: 'Type de liste et parcours',
		categories: 'Catégories',
		categoriesHelp:
			'L’ordre par défaut pour « Par catégorie ». Vous pouvez définir un parcours par liste ci-dessus.',
		newCategory: 'Nouvelle catégorie',
		data: 'Données',
		importExport: 'Import & export',
		formatsAi: 'JSON, CSV, ZIP et analyse IA',
		formats: 'JSON, CSV et ZIP',
		backupNow: 'Faire une sauvegarde sur le serveur',
		backupHelp:
			'Le serveur fait aussi une sauvegarde automatique chaque jour. Voir le README pour restaurer.',
		app: 'Application',
		install: 'Installer sur l’écran d’accueil',
		installed: 'Installée comme application',
		installHelp:
			'Pour installer : ouvrez le menu du navigateur et choisissez « Ajouter à l’écran d’accueil » ou « Installer l’application ».',
		httpsWarning:
			'Cette connexion n’est pas en HTTPS. La liste fonctionne, mais l’installation et le démarrage hors ligne nécessitent HTTPS (voir README).',
		offlineReady: ' · disponible hors ligne'
	},
	data: {
		subtitle: 'Import et export',
		export: 'Export',
		import: 'Import',
		backupLabel: 'Sauvegarde complète avec photos (ZIP)',
		backupDetail:
			'Toutes les données plus les photos des produits. Le meilleur fichier pour tout restaurer via Import.',
		jsonLabel: 'Export complet (JSON)',
		jsonDetail:
			'Toutes les données avec historique, identifiants et horaires, mais sans les photos elles-mêmes. Restaurable via Import.',
		zipLabel: 'Tout en CSV (ZIP)',
		zipDetail: 'Achats, produits, statistiques, listes et catégories en fichiers CSV séparés.',
		purchasesLabel: 'Achats (CSV)',
		purchasesDetail: 'Chaque achat avec produit, liste, horaires et quantité.',
		productsLabel: 'Produits (CSV)',
		productsDetail: 'Tous les produits avec catégorie et favori.',
		statisticsLabel: 'Statistiques (CSV)',
		statisticsDetail: 'Nombre d’achats, intervalle moyen et prochain achat prévu.',
		importJsonLabel: 'Export complet ou sauvegarde',
		importJsonHint:
			'Un export JSON ou une sauvegarde ZIP de 8star (aussi de v1.0 et v1.1). Fusionner ou tout remplacer. Les photos ne viennent que de la sauvegarde ZIP.',
		importProductsHint:
			'Colonnes : product (obligatoire), category, favorite (yes/no), product_id. Séparateur ; ou ,',
		importPurchasesHint:
			'Colonnes : product et purchased_at (obligatoires), quantity, unit, list, category, purchase_id. Dates comme 2026-10-24T18:30:00Z ou 24-10-2026 18:30.',
		aiTitle: 'Analyser avec l’IA',
		aiStep1: ['Téléchargez l’', 'export complet (JSON)', ' ci-dessus.'],
		aiStep2: ['Donnez-le avec la ', 'consigne IA', ' à ChatGPT ou votre propre script Python.'],
		aiStep3: ['Importez la réponse sous ', 'Suggestions → Suggestions IA', '.'],
		aiDownload: 'Télécharger la consigne IA'
	},
	server: {
		invalidOp: (detail) => `Modification invalide : ${detail}`,
		unknown: 'inconnu',
		constraint:
			'La modification n’a pas pu être enregistrée (conflit avec des données existantes).',
		itemGone: 'Cet article n’existe plus (supprimé sur un autre appareil).',
		itemTicked: (name) => `« ${name} » n’est plus sur la liste (coché entre-temps).`,
		listGone: 'Cette liste n’existe plus.',
		productGone: 'Ce produit n’existe plus.',
		lastList: 'La dernière liste ne peut pas être supprimée.',
		notChecklist: 'Seule une checklist peut être remise à faire.',
		categoryGone: 'Cette catégorie n’existe plus.',
		groceryOnly: 'Ceci ne fonctionne que sur une liste de courses.',
		mediaMissing: 'La photo n’est pas arrivée sur le serveur. Choisissez de nouveau la photo.',
		aliasIsName: (alias, name) => `« ${alias} » est déjà le nom du produit « ${name} ».`,
		aliasIsAlias: (alias, name) => `« ${alias} » est déjà un mot-clé pour « ${name} ».`,
		alreadyOnList: (name) => `« ${name} » est déjà sur la liste.`,
		notOnList: (name) => `« ${name} » n’est plus sur la liste.`,
		unknownQtyChoose: (name) =>
			`La quantité de « ${name} » est inconnue. Choisissez d’abord une quantité.`,
		incompatibleUnit: (name, existing, delta) =>
			`« ${name} » est déjà sur la liste avec ${existing} ; ${delta} est une autre unité. Choisissez d’abord ce que vous voulez.`,
		tooLarge: 'Cette quantité est trop grande.',
		partialGroceryOnly: 'Acheté en partie ne fonctionne que sur une liste de courses.',
		unknownQty: (name) => `La quantité de « ${name} » est inconnue.`,
		useUnitOf: (name) => `Utilisez l’unité de « ${name} ».`,
		useComplete: (name) => `Tout acheté pour « ${name} » ? Cochez alors le produit.`,
		changedElsewhere: (name) =>
			`« ${name} » a été modifié entre-temps sur un autre appareil. Votre modification a été enregistrée.`,
		claimedBy: (device, name) => `${device} s’occupe déjà de « ${name} ».`,
		bundleDuplicate: (name) => `« ${name} » figure deux fois dans le lot.`,
		roundGroceryOnly: 'Une tournée de courses ne fonctionne que sur une liste de courses.',
		recGone: 'Cette suggestion IA n’existe plus.',
		productExists: (name) => `Un produit « ${name} » existe déjà.`,
		aliasOfOther: (name) => `« ${name} » est déjà un mot-clé pour un autre produit.`,
		undoChangedElsewhere:
			'Impossible d’annuler : cela a été modifié entre-temps sur un autre appareil.',
		undoSimilarExists: 'Impossible d’annuler : quelque chose de semblable existe désormais.',
		undoListGone: 'Impossible d’annuler : la liste n’existe plus.',
		undoQtyChanged:
			'Impossible d’annuler : la quantité a été modifiée entre-temps d’une autre manière.'
	},
	media: {
		tooLarge: (mb) => `La photo dépasse ${mb} Mo.`,
		invalid: 'Pas une photo valide.',
		type: 'Seules les photos JPEG, PNG ou WebP sont acceptées.',
		tooSmall: 'La photo est trop petite.',
		tooBig: (px) => `La photo est trop grande (max ${px} px par côté).`,
		corrupt: (kind) => `${kind} endommagé.`,
		rotated:
			'La photo contient une rotation dans ses métadonnées ; choisissez-la via l’application.',
		badId: 'Identifiant de photo invalide.',
		idTaken: 'Une autre photo avec cet identifiant existe déjà.',
		notFound: 'Photo introuvable'
	},
	import: {
		zipUnreadable: (detail) => `Le fichier ZIP ne peut pas être lu : ${detail}`,
		unknownError: 'erreur inconnue',
		zip: {
			invalid: 'pas un fichier ZIP valide',
			too_many: 'trop de fichiers dans l’archive',
			corrupt_directory: 'table des matières endommagée',
			too_large: 'l’archive est trop volumineuse une fois décompressée',
			corrupt_entry: 'fichier endommagé dans l’archive',
			truncated: 'l’archive est tronquée',
			extract: (entry) => `impossible de décompresser « ${entry} »`,
			compression: (entry) => `compression non prise en charge dans « ${entry} »`,
			checksum: (entry) => `la somme de contrôle de « ${entry} » ne correspond pas`
		},
		notBackup:
			'Ce fichier ZIP n’est pas une sauvegarde 8star (manifest.json manque). Les exports CSV en ZIP ne peuvent pas être restaurés.',
		manifestInvalid: 'manifest.json n’est pas un JSON valide.',
		unknownBackupFormat: (format) => `Format de sauvegarde inconnu (attendu "${format}").`,
		backupVersion: (version) =>
			`La version de sauvegarde ${version} n’est pas prise en charge ; mettez l’application à jour.`,
		exportMissing: 'export.json manque dans la sauvegarde.',
		invalidJson: 'Le fichier n’est pas un JSON valide.',
		replaceNeedsList: 'Un remplacement complet nécessite au moins une liste.',
		suggestionsNotApplied:
			'Le réglage des suggestions du fichier n’a pas été repris (seulement en remplaçant tout).',
		bulkAddNotApplied:
			'Le réglage « Ajouter plusieurs » du fichier n’a pas été repris (seulement en remplaçant tout).',
		languageNotApplied: 'La langue du fichier n’a pas été reprise (seulement en remplaçant tout).',
		csvUnclosed: 'Guillemet non fermé dans le fichier CSV.',
		csvEmpty: 'Le fichier CSV est vide.',
		failed: (detail) => `L’importation a échoué et a été entièrement annulée : ${detail}`,
		nothingChanged: 'Rien n’a été modifié.',
		suggestionsSetting: (on, preview) =>
			`Suggestions ${preview ? 'seront ' : ''}${on ? 'affichées' : 'masquées'} (réglage du fichier)`,
		bulkAddSetting: (on, preview) =>
			`« Ajouter plusieurs » ${preview ? 'sera ' : ''}${on ? 'affiché' : 'masqué'} (réglage du fichier)`,
		languageSetting: (name, preview) =>
			`Langue ${preview ? 'sera ' : ''}${name} (réglage du fichier)`,
		photoSkipped: (id, detail) => `Photo ${id} ignorée : ${detail}`,
		unreadable: 'illisible',
		photosMissing: (n) =>
			`${plural(n, 'photo de produit absente', 'photos de produit absentes')} de ce fichier : seule la sauvegarde complète (ZIP) contient les photos.`,
		notObject: 'Le fichier doit être un objet JSON.',
		notAiFile: (format) => `Pas un fichier de suggestions IA : attendu "format": "${format}".`,
		aiVersion: (version, expected) =>
			`formatVersion ${version} n’est pas prise en charge (attendu ${expected}).`,
		recommendationsEmpty: '"recommendations" doit être une liste non vide.',
		tooManyRecommendations: (max) => `Au maximum ${max} suggestions par fichier.`,
		summary: {
			labels: {
				lists: ['liste', 'listes'],
				categories: ['catégorie', 'catégories'],
				products: ['produit', 'produits'],
				listItems: ['article sur une liste', 'articles sur des listes'],
				purchaseEvents: ['achat', 'achats'],
				aiRecommendations: ['suggestion IA', 'suggestions IA'],
				productAliases: ['mot-clé', 'mots-clés'],
				bundles: ['lot', 'lots'],
				media: ['photo', 'photos']
			},
			action: (counted, n, action, preview) =>
				`${counted} : ${
					preview
						? { removed: 'à supprimer', added: 'à ajouter', updated: 'à mettre à jour' }[action]
						: { removed: 'supprimé', added: 'ajouté', updated: 'mis à jour' }[action] +
							(n === 1 || action === 'updated' ? '' : 's')
				}`,
			matched: (counted) => `${counted} : déjà présent`,
			duplicates: (n) => `${n} en double (ignoré)`,
			skipped: (n) => `${n} ignoré`,
			nothing: 'Aucune modification : tout y était déjà.'
		},
		ai: {
			at: (i) => `Suggestion ${i}`,
			notObject: (at) => `${at} : pas un objet, ignorée.`,
			badProductId: (at) => `${at} : "productId" manque ou est invalide, ignorée.`,
			unknownProduct: (at, id) => `${at} : le produit "${id}" n’existe pas, ignorée.`,
			nameMismatch: (at, given, id, name) =>
				`${at} : productName "${given}" ne correspond pas à ${id} ("${name}") ; l’identifiant a été utilisé.`,
			confidence: (at) => `${at} : "confidence" doit être un nombre entre 0 et 1, ignorée.`,
			reasoning: (at, max) => `${at} : "reasoning" manque ou dépasse ${max} caractères, ignorée.`,
			quantity: (at) => `${at} : "suggestedQuantity" doit être un nombre supérieur à 0, ignorée.`,
			unit: (at, unit) => `${at} : unité inconnue "${unit}", ignorée.`,
			date: (at) => `${at} : "nextPurchaseDate" n’est pas une date ISO 8601, ignorée.`,
			repeated: (at) => `${at} : apparaît plusieurs fois dans le fichier ; la dernière compte.`,
			noneValid: 'Aucune suggestion valide trouvée.'
		},
		csv: {
			productColumnHeader:
				'La colonne "product" manque (la première ligne doit contenir les noms de colonnes).',
			productColumn: 'La colonne "product" manque.',
			purchasedColumn: 'La colonne "gekocht" ou "purchased_at" (moment d’achat) manque.',
			line: (n, message) => `Ligne ${n} : ${message}`,
			badName: 'nom de produit manquant ou trop long.',
			badProductId: (id) => `product_id invalide "${id}".`,
			invalidLines: (n) =>
				`${plural(n, 'ligne invalide', 'lignes invalides')} ; rien n’a été importé.`,
			noProducts: 'Le fichier ne contient aucun produit.',
			noPurchases: 'Le fichier ne contient aucun achat.',
			badStatus: (status) => `statut inconnu "${status}" (purchased, cancelled ou open).`,
			badDate: (raw) =>
				`date invalide ou manquante "${raw}" (p. ex. 2026-10-24T18:30:00Z ou 24-10-2026 18:30).`,
			badActivated: (raw) => `date invalide "${raw}" dans la colonne activated.`,
			badQuantity: (raw) => `quantité invalide "${raw}".`,
			badUnit: (unit) => `unité inconnue "${unit}".`,
			badId: 'identifiant invalide.',
			skippedOpen: (n) =>
				`${plural(n, 'ligne', 'lignes')} avec le statut "open" ignorée(s) (ce ne sont pas des achats).`,
			unknownLists: (lists) => `Liste(s) inconnue(s) ${lists} : achats conservés sans liste.`
		},
		validate: {
			object: 'doit être un objet',
			array: 'doit être une liste (array)',
			tooMany: (max) => `trop d’enregistrements (max ${max})`,
			id: 'identifiant invalide (lettres, chiffres, - et _, max 64 caractères)',
			name: (max) => `nom manquant ou de plus de ${max} caractères`,
			time: 'date/heure invalide (attendu ISO 8601, p. ex. 2026-10-24T08:30:00Z)',
			quantity: 'quantité invalide (nombre supérieur à 0)',
			unit: (allowed) => `unité inconnue (autorisées : ${allowed})`,
			note: (max) => `note de plus de ${max} caractères`,
			number: 'doit être un nombre',
			integer: 'doit être un nombre entier',
			file: 'fichier',
			version: (version, max) =>
				`la version ${version} n’est pas prise en charge (max ${max}) ; mettez l’application à jour`,
			legacy: 'Ancien format d’export (v1.0.0) reconnu et converti.',
			notExport: (format) => `pas un export 8star (attendu "format": "${format}")`,
			oneOf: (values) => `doit être l’un de ${values}`,
			boughtAndCancelled: 'ne peut pas être à la fois acheté et annulé',
			completedRequired: 'obligatoire pour les articles cochés',
			between: (a, b) => `doit être un nombre entre ${a} et ${b}`,
			fileName: 'nom de fichier invalide',
			missing: 'manquant',
			duplicateId: (id) => `identifiant en double "${id}"`,
			duplicateProduct: (name, id1, id2) =>
				`le produit "${name}" apparaît deux fois (${id1} et ${id2})`,
			unknownCategory: (id) => `catégorie inconnue "${id}"`,
			unknownList: (id) => `liste inconnue "${id}"`,
			unknownProduct: (id) => `produit inconnu "${id}"`,
			unknownPurchase: (id) => `achat inconnu "${id}"`,
			twiceOnList: 'le produit figure deux fois sur la même liste',
			purchaseListMissing: (eventId, listId) =>
				`Achat ${eventId} : la liste "${listId}" n’existe pas dans le fichier ; conservé sans liste.`,
			aliasIsName: (alias) => `"${alias}" est aussi un nom de produit`,
			aliasTwice: (alias) => `le mot-clé "${alias}" apparaît deux fois`,
			twiceInBundle: 'le produit figure deux fois dans le lot',
			preferredListMissing: (id) =>
				`Produit ${id} : la liste préférée n’existe pas dans le fichier ; ignorée.`
		}
	},
	manifest: {
		name: '8star Courses',
		shortName: 'Courses',
		description: 'Liste de courses partagée pour tout le foyer, même hors ligne.',
		htmlDescription: 'Liste de courses partagée pour tout le foyer.'
	}
};
