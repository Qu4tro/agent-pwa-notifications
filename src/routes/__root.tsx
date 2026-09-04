import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '../lib/brand'
import appCss from '../styles.css?url'

// The router hands every route the one QueryClient, so a loader can warm a
// query before the page renders.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        // No maximum-scale: pinch-zoom stays available (WCAG 1.4.4).
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: APP_NAME },
      { name: 'description', content: APP_TAGLINE },
      // Matches --color-bg, so the browser chrome and the app share one surface.
      { name: 'theme-color', content: '#0f1115' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'apple-mobile-web-app-title', content: APP_SHORT_NAME },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
      { rel: 'apple-touch-icon', href: '/icon-192.png' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
        {/* Register the service worker for push + install. Inline so it runs
            before hydration and works even if the SPA bundle is slow. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`,
          }}
        />
        {/* Dev only: the uxnote-fork annotation bar, so the UI can be marked up
            in place. It loads from the reference server in ../uxnote-fork:

              python3 server/server.py --port 8123 --root . --api-key review-key

            The notes live on that server (one set per origin), so they survive
            a reload and a second browser sees the same ones. With the server
            down the widget just does not appear. Never in a production build:
            `import.meta.env.DEV` is replaced with `false` and the whole element
            is dropped. */}
        {import.meta.env.DEV ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var b='http://localhost:8123';function add(p,a,n){var s=document.createElement('script');s.src=b+p;if(a)for(var k in a)s.setAttribute(k,a[k]);s.onload=n||null;s.onerror=function(){console.info('[uxnote] no annotation server at '+b+' - run it from ../uxnote-fork to annotate this page')};document.body.appendChild(s)}add('/uxnote-tool/snapdom.min.js',null,function(){add('/uxnote-tool/uxnote.js',{'data-server-url':b,'data-server-api-key':'review-key','data-theme':'auto','data-json-export':'false','data-json-import':'false'})})})()`,
            }}
          />
        ) : null}
      </body>
    </html>
  )
}
