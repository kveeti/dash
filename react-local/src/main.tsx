import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Entrypoint } from './entrypoint';

import './styles.css';
import { Providers } from './providers';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <Entrypoint />
    </Providers>
  </StrictMode>,
);

