import type { IconName } from '@/components/icon/icons';
import type { SettingsPageSlug } from './metadata';

const SNIPPETS_SETTINGS_ICON = { icon: 'chat-thread' } as const;

export function getSettingsNavIcon(slug: SettingsPageSlug): IconName | null {
  switch (slug) {
    case 'projects':
      return 'folders';
    case 'remote-instances':
      return 'server';
    case 'appearance':
      return 'palette';
    case 'chat':
      return 'chat-ai-3';
    case 'magic-prompts':
      return 'ai-generate-2';
    case 'snippets':
      return SNIPPETS_SETTINGS_ICON.icon;
    case 'notifications':
      return 'notification-3';
    case 'shortcuts':
      return 'command';
    case 'sessions':
      return 'chat-history';

    case 'providers':
      return 'cloud';
    case 'agents':
      return 'ai-agent';
    case 'behavior':
      return 'brain';
    case 'commands':
      return 'slash-commands-2';
    case 'mcp':
      return 'plug-2';
    case 'plugins':
      return 'code-box';

    case 'skills.installed':
      return 'book-open';
    case 'skills.catalog':
      return 'book';

    case 'git':
      return 'git-branch';

    case 'usage':
      return 'bar-chart-2';
    case 'home':
      return null;
    default:
      return 'settings-3';
  }
}
