/** Copy shared by onboarding, rules and privacy screens. */

export const SAFETY_RULES: { title: string; body: string }[] = [
  {
    title: 'Drivers never use the phone',
    body: 'Hunters may travel by car, but only passengers operate MANHUNT. Obey all traffic laws and speed limits. A ping is never a reason to hurry.',
  },
  {
    title: 'Stay inside the play area',
    body: 'Keep to public, walkable places. No private property, building sites, railways, motorways or dangerous roads.',
  },
  {
    title: 'Tags, not tackles',
    body: 'A capture is a light tag plus confirmation in the app. No grabbing, chasing into traffic or physical confrontation.',
  },
  {
    title: 'Look up',
    body: 'Watch where you are going. Never cross roads while looking at your phone.',
  },
  {
    title: 'Anyone can stop the game',
    body: 'Use Emergency stop from the menu at any time. It pauses play and turns off location sharing for everyone.',
  },
];

export const BROWSER_LIMITS = [
  'Keep MANHUNT open with the screen on during the game. Phone browsers pause GPS when the screen locks or you switch apps. iOS Safari stops it completely.',
  'Turn on "Keep screen awake" in Settings to stop the screen locking (supported on recent iOS and Android).',
  'If your phone cannot get a fix, hunters see "missed ping" and nothing else. MANHUNT never invents a location.',
  'Installing MANHUNT to your home screen gives a full-screen view. It does not enable background GPS.',
];

export const PRIVACY_POINTS = [
  'MANHUNT only shares your location while you are in a game that is running, and only after you allow it.',
  'Runners: hunters only see your location at each ping, as one snapshot with its age and accuracy. They never see you live.',
  'Hunters: your live location is shared only with your fellow hunters (if the host allows it). Runners never see it.',
  'The server keeps only your latest position, in memory. It is overwritten on every update and never stored as a history.',
  'Ping snapshots are deleted 60 minutes after the game ends. The game itself is deleted after 24 hours.',
  'There are no accounts, tracking cookies or ads. Your identity is a random token stored on this device.',
  'You can pause location sharing or leave the game at any time.',
];
