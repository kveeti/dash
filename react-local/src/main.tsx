import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Entrypoint } from './entrypoint';

import './styles.css';
import { Providers } from './providers';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <ReactQueryDevtools />
      <Entrypoint />
    </Providers>
  </StrictMode>,
);

