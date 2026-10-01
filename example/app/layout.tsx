export const metadata = {
  title: 'Rivium Flags — Next.js SDK example',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '20px', background: '#f5f5f5' }}>
        {children}
      </body>
    </html>
  );
}
