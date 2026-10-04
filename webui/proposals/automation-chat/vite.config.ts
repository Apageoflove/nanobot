import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseTailwind from '../../tailwind.config.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const webui = path.resolve(root, '../..');
const repository = path.dirname(webui);
const realAutomations = normalizePath(path.join(webui, 'src/components/settings/system/AutomationsSettings.tsx'));
const linkedChat = `        <dl>
          {!job.protected && job.origin?.channel && job.origin.channel !== "websocket" ? (
            <AutomationDetail label={tx("settings.automations.labels.origin", "Linked chat")}>
              {automationChannelLabel(job.origin.channel, t)}
            </AutomationDetail>
          ) : null}
        </dl>`;
const panelStart = '          <AutomationDetailPanel\n';
const panelEnd = '            onRequestDelete={onRequestDelete}\n          />';
const actionsStart = '      {canManage ? (\n        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/45 px-6 py-3">';
const actionsEnd = '\n      ) : null}';

// These opt-in slots never edit product source or enter the production build.
export default defineConfig({
  root,
  publicDir: path.join(webui, 'public'),
  cacheDir: path.join(root, '.vite'),
  plugins: [{
    name: 'automation-chat-proposal',
    enforce: 'pre',
    transform(source, id) {
      if (normalizePath(id.split('?')[0]) !== realAutomations) return;
      const code = source.replace(/\r\n/g, '\n');
      for (const anchor of [linkedChat, panelStart, panelEnd, actionsStart]) {
        if (code.split(anchor).length !== 2) {
          throw new Error('Automation detail markup changed. Update the proposal seam.');
        }
      }
      const from = code.indexOf(actionsStart);
      const to = code.indexOf(actionsEnd, from);
      if (to < 0) throw new Error('Automation detail actions changed. Update the proposal seam.');
      const actions = code.slice(from, to + actionsEnd.length);
      return {
        code: `import { BindingControls, BindingDialogFrame, BindingDetailActions } from ${JSON.stringify(normalizePath(path.join(root, 'BindingControls.tsx')))};\n`
          + code.replace(linkedChat, `        <BindingControls job={job} currentUi={${linkedChat.trim()}} />`)
            .replace(panelStart, '          <BindingDialogFrame key={job.id} job={job}><AutomationDetailPanel\n')
            .replace(panelEnd, '            onRequestDelete={onRequestDelete}\n          /></BindingDialogFrame>')
            .replace(actions, `      {canManage ? <BindingDetailActions job={job} busy={busy} canToggle={canToggle} canRun={canRun} localTrigger={localTrigger} originHref={originHref}
              onToggle={() => void onAction(job.enabled ? "disable" : "enable", job)} onRun={() => void onAction("run", job)}
              onEdit={() => onRequestEdit(job)} onDelete={() => onRequestDelete(job)} currentUi={<>{${actions.trim().slice(1, -1)}}</>} /> : null}`),
        map: null,
      };
    },
  }, react()],
  resolve: {
    alias: { '@': path.join(webui, 'src') },
    dedupe: ['react', 'react-dom', 'lucide-react', 'react-i18next', 'i18next'],
  },
  css: {
    postcss: {
      plugins: [tailwindcss({
        ...baseTailwind,
        content: [
          normalizePath(path.join(webui, 'src/**/*.{ts,tsx}')),
          normalizePath(path.join(repository, 'nanobot/channels/*/webui/**/*.{ts,tsx}')),
          normalizePath(path.join(webui, 'node_modules/streamdown/dist/*.js')),
          normalizePath(path.join(root, '*.{tsx,html}')),
        ],
      }), autoprefixer()],
    },
  },
  // No API proxy. The proposal must not talk to an installed gateway.
  server: { host: '127.0.0.1', port: 53822, strictPort: true, fs: { allow: [repository] } },
  preview: { host: '127.0.0.1', port: 53822, strictPort: true },
  build: { outDir: path.join(root, 'dist') },
});
