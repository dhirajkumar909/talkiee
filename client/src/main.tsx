import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider, useTheme } from './lib/theme';
import { initPWA } from './lib/pwa';
import './index.css';

initPWA();

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-center" richColors theme={theme} />;
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ThemeProvider>
      <AuthProvider>
        <App />
        <ThemedToaster />
      </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>,
);
