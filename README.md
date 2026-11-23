# NuissGo — geração, publicação e propriedade via Google

## Recursos desta versão
- Login com Google, usando o seletor de contas do Google.
- O e-mail da conta autenticada vira o proprietário do site criado.
- O administrador principal é `juliocesarnunes277@gmail.com`.
- Sites gerados são salvos no Cloudflare D1 e publicados automaticamente em `/s/<slug>`.
- O administrador principal consegue consultar todos os sites.
- Endpoint protegido para transferência de propriedade pelo administrador.
- A chave Gemini e o segredo de sessão ficam no servidor.

## Configuração inicial (uma única vez)
É necessário configurar as contas e publicar a aplicação uma vez. Depois, ela roda na infraestrutura da Cloudflare sem manter seu celular ou computador ligado.

1. Crie conta Cloudflare e projeto no Google Cloud Console.
2. No Google Cloud Console, configure OAuth consent screen (External) e crie um OAuth Client ID do tipo Web application.
3. Em Authorized JavaScript origins, adicione a URL pública do Worker, por exemplo `https://nuissgo.seu-subdominio.workers.dev`.
4. Adicione o domínio `https://accounts.google.com` não é redirect URI; o Google Identity Services usa a origem JavaScript. Configure a tela de consentimento e usuários de teste enquanto o app estiver em teste.
5. Instale Node.js e Wrangler: `npm install -g wrangler`; autentique: `wrangler login`.
6. Crie o D1: `wrangler d1 create nuissgo-sites`. Copie o `database_id` retornado para `wrangler.toml`.
7. Crie as tabelas: `wrangler d1 execute nuissgo-sites --remote --file=schema.sql`.
8. Cadastre os secrets/variáveis:
   - `wrangler secret put GEMINI_API_KEY`
   - `wrangler secret put SESSION_SECRET` (use um valor aleatório forte, longo e exclusivo)
   - `wrangler secret put GOOGLE_CLIENT_ID`
   - `wrangler secret put ADMIN_EMAIL` e informe `juliocesarnunes277@gmail.com`
9. Publique: `wrangler deploy`.

## Como escolher a conta responsável
Na tela inicial, clique em “Entrar com Google” e selecione a conta que será proprietária do novo site. Cada novo site fica associado ao e-mail autenticado. O administrador principal tem acesso administrativo aos registros.

## Importante
- A autenticação usa Google Identity Services e valida o ID token no servidor; sessão em cookie HttpOnly/Secure/SameSite.
- O endpoint de transferência está protegido para o administrador, mas a interface de transferência ainda precisa ser adicionada ao painel antes de uso por clientes.
- Nesta versão inicial, os sites publicados são públicos por link. Não coloque dados pessoais sensíveis no conteúdo.
- A lista de sites é filtrada por proprietário, exceto para o administrador principal.
- A geração depende das cotas da Gemini API; hospedagem contínua não garante geração ilimitada.
- Domínios próprios e subdomínios individuais exigem configuração DNS/Cloudflare adicional.
- Nenhum sistema pode prometer zero bugs; revise e teste antes de vender.

## Arquivos
- `public/index.html`: interface.
- `worker.js`: login, sessão, geração, publicação, listagem e endpoint administrativo de transferência.
- `schema.sql`: banco de dados.
- `wrangler.toml`: configuração Cloudflare.
