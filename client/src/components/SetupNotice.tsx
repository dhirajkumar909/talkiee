import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

/** Shown across the app until Supabase env vars are present. */
export function SetupNotice() {
  return (
    <div className="min-h-screen bg-dots flex items-center justify-center p-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl">Almost there — connect Supabase</CardTitle>
          <CardDescription>
            talkiee needs a Supabase project for accounts, offices, and realtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>
              Create a free project at{' '}
              <a className="text-foreground underline" href="https://supabase.com" target="_blank" rel="noreferrer">
                supabase.com
              </a>
              .
            </li>
            <li>
              Open <span className="font-mono text-foreground">supabase/schema.sql</span> from this repo and run it in
              the Supabase <span className="text-foreground">SQL Editor</span>.
            </li>
            <li>
              Copy <span className="font-mono text-foreground">client/.env.example</span> to{' '}
              <span className="font-mono text-foreground">client/.env</span> and fill in your Project URL + anon key
              (Project Settings → API).
            </li>
            <li>Restart the dev server.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
