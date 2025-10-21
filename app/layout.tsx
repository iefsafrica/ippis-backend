export const metadata = {
  title: 'IPPIS HR API',
  description: 'Backend API for HR Management System',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  );
}
