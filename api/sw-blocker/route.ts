import { NextResponse } from "next/server"

export async function GET() {
  return new NextResponse(
    `<!DOCTYPE html>
    <html>
    <head>
      <title>Service Worker Blocker</title>
      <script>
        // Unregister all service workers
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for (let registration of registrations) {
              registration.unregister();
            }
          });
          
          // Replace the serviceWorker object
          Object.defineProperty(navigator, 'serviceWorker', {
            value: null,
            configurable: true,
            enumerable: true,
            writable: false
          });
        }
        
        // Redirect back to the application
        window.location.href = '/';
      </script>
    </head>
    <body>
      <p>Disabling service workers...</p>
    </body>
    </html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Service-Worker-Allowed": "false",
        "Clear-Site-Data": '"storage"',
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  )
}
