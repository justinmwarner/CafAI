// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/dev/vite.probe.config.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: keeps the base plugins, measures CafAI's test ids, touch targets and the keyboard.

/**
 * Dev-only config for measuring the skin ON a real device.
 *
 * The reason this exists: `env(safe-area-inset-*)` is 0 in every desktop
 * browser and 0 inside an iframe, so neither `vite dev` on a desktop nor
 * `dev/tablet.html` can tell you what an actual tablet reports. This serves
 * the app normally and injects a probe that reports the live geometry back to
 * the terminal, so a layout claim about the tablet can be checked instead of
 * assumed.
 *
 *   npx vite --config dev/vite.probe.config.ts --host 0.0.0.0 --port 5180
 *
 * then open http://<this machine>:5180/ on the tablet (add ?sweep=1 to walk
 * every screen). It is never part of a build: `npm run build` uses
 * vite.config.ts.
 */

import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import base from '../vite.config.ts';

const probe = (): Plugin => ({
  name: 'cafai-device-probe',
  apply: 'serve',

  transformIndexHtml() {
    return [
      {
        tag: 'script',
        injectTo: 'body',
        // ES5 on purpose: this runs on the tablet's old WebView.
        children: `
          (function () {
            // Measure the variable the layout actually uses, not env()
            // directly: inside the desktop harness env() is 0 and the inset is
            // injected as --safe-<name>, so reading env() here would report a
            // safe line the layout is not using and quietly pass everything.
            var read = function (name) {
              var el = document.createElement('div');
              el.style.cssText = 'position:fixed;height:var(--safe-' + name + ',0px)';
              document.body.appendChild(el);
              var value = el.getBoundingClientRect().height;
              document.body.removeChild(el);
              return Math.round(value);
            };
            var box = function (testId) {
              var el = document.querySelector('[data-testid="' + testId + '"]');
              if (!el) return null;
              var r = el.getBoundingClientRect();
              return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
            };

            // ?sweep=1 walks every screen once and returns to the coach, so a
            // device check does not depend on someone standing there tapping.
            if (location.search.indexOf('sweep=1') >= 0) {
              var order = ['#/', '#/history', '#/settings', '#/'];
              var step = 0;
              var walk = function () {
                if (step >= order.length) return;
                location.hash = order[step++];
                setTimeout(walk, 2600);
              };
              setTimeout(walk, 2500);
            }

            var last = '';
            setInterval(function () {
              if (!document.querySelector('[data-testid="app-ready"]')) return;
              var bottom = read('bottom');
              var safeLine = window.innerHeight - bottom;
              var exit = box('exit-to-skins');
              var stop = box('stop-button');
              var composer = box('composer-input');
              var vv = window.visualViewport;

              // Anything a thumb must hit should be at least 48 px both ways.
              var small = [];
              var controls = document.querySelectorAll('button, a[href], [role="button"], input, textarea, select');
              for (var i = 0; i < controls.length; i++) {
                var r = controls[i].getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.width < 47.5 || r.height < 47.5) {
                  small.push((controls[i].getAttribute('data-testid') || controls[i].textContent || controls[i].tagName).trim().slice(0, 24));
                }
              }

              var report = {
                route: location.hash || '#/',
                vw: window.innerWidth,
                vh: window.innerHeight,
                dpr: window.devicePixelRatio,
                visualViewportH: vv ? Math.round(vv.height) : null,
                touchPoints: navigator.maxTouchPoints || 0,
                safe: [read('top'), read('right'), bottom, read('left')].join('/'),
                safeLine: safeLine,
                exitVisible: !!exit && exit.top >= 0 && exit.bottom <= safeLine,
                stop: stop,
                // Decaid's exit-hint snackbar covers about the bottom 84 px for 10 s.
                stopClearOfSnackbar: !stop || stop.bottom <= window.innerHeight - 84,
                composer: composer,
                composerAboveKeyboard: !composer || !vv || composer.bottom <= vv.height,
                smallTargets: small.length,
                smallTargetSample: small.slice(0, 6),
                scrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
                hScroll: document.documentElement.scrollWidth > window.innerWidth + 1
              };

              var payload = JSON.stringify(report);
              if (payload === last) return;
              last = payload;
              new Image().src = '/__probe?d=' + encodeURIComponent(payload) + '&t=' + Date.now();
            }, 1200);
          })();
        `,
      },
    ];
  },

  configureServer(server) {
    server.middlewares.use('/__probe', (req, res) => {
      const query = (req.url ?? '').split('d=')[1]?.split('&')[0] ?? '';
      try {
        console.log('[probe] ' + decodeURIComponent(query));
      } catch {
        console.log('[probe] <unparseable>');
      }
      res.statusCode = 204;
      res.end();
    });
  },
});

export default defineConfig(async (env: ConfigEnv) => {
  const resolved: UserConfig = typeof base === 'function' ? await base(env) : await base;
  return { ...resolved, plugins: [...(resolved.plugins ?? []), probe()] };
});
