# Supabase do Rhythm Dash

O projeto é estático (GitHub Pages) e usa a API REST do Supabase diretamente no navegador. A integração e o esquema SQL ficam em `src/core/supabase.js` e `supabase/schema.sql`.

## O que já está no repositório

- Cadastro por e-mail/senha, login, persistência/renovação da sessão e confirmação de e-mail.
- Recorde máximo por faixa, salvo localmente e enviado ao Supabase quando há sessão.
- Sincronização no login: envia recordes locais daquela conta e baixa os recordes da nuvem. Recordes de convidado podem ser importados explicitamente após login, evitando atribuí-los automaticamente em aparelhos compartilhados.
- RLS na tabela: cada jogador só pode consultar/alterar os próprios registros.
- A configuração do frontend usa a URL e a chave **publishable** fornecidas para este projeto. Essa chave é pública e pode estar no bundle; **nunca** substitua por `service_role` ou por uma chave secreta.

## Configuração que precisa ser aplicada no painel do Supabase

O repositório não tem acesso administrativo ao painel/API de gerenciamento do projeto. Faça estes passos uma vez no projeto `dlofouyzbqsqbjhbheqh`:

1. **Database → SQL Editor**: execute o arquivo completo `supabase/schema.sql`. Ele cria `public.player_records`, ativa RLS, cria as políticas por usuário e a RPC atômica `submit_player_record`.
2. **Authentication → Sign In / Providers → Email**: habilite e-mail/senha. Recomenda-se manter a confirmação de e-mail ativa.
3. **Authentication → URL Configuration**:
   - Site URL: `https://joaocaetano19.github.io/Mobile/`
   - Redirect URL permitida: `https://joaocaetano19.github.io/Mobile/`
   - Para desenvolvimento local, acrescente `http://localhost:5173/`.
   No GitHub Pages e em `http://localhost:5173/`, o app solicita que a confirmação volte à URL atual. Em previews temporários fora da allowlist, ele deixa o Supabase usar a Site URL, evitando que o cadastro falhe por redirect não permitido. Se trocar o domínio publicado, atualize a URL canônica em `src/core/supabase.js` e esta lista.
4. **Authentication → SMTP Settings**: configure um SMTP próprio antes de abrir o cadastro ao público. O SMTP de teste/padrão do Supabase é limitado e não entrega livremente para qualquer endereço. Configure remetente, host, porta, usuário e senha, e teste o template de confirmação.
5. Em **Authentication → Email Templates**, mantenha o link de confirmação usando `{{ .ConfirmationURL }}`. O app consome a sessão retornada no fragmento da URL e limpa os tokens da barra de endereço.
6. Em **Project Settings → API**, confirme que a URL do projeto e a chave pública correspondem às constantes em `src/core/supabase.js`. Só a chave publishable pode ser exposta no frontend.

## Verificação ponta a ponta

1. Publique/recarregue o site depois do build e abra o painel **Conta e recordes**.
2. Crie uma conta com um endereço acessível; a tela oferece reenvio do link caso ele não chegue. Abra a confirmação no navegador e retorne ao app.
3. Entre, jogue uma faixa demo até morrer ou concluir e confirme que o painel informa a sincronização.
4. Entre com a mesma conta em outro celular e confira que o recorde aparece no painel.
5. No SQL Editor, confira a tabela `public.player_records`; cada linha deve ter o `user_id` da conta. Teste com duas contas diferentes para confirmar que a RLS não expõe os recordes de outra pessoa.

Se a confirmação estiver desativada no painel, o cadastro entra imediatamente. Para um app público, habilite confirmação e SMTP para evitar contas com e-mails não verificados.

## Limites de segurança

A tabela e as políticas impedem que um jogador leia ou altere diretamente os registros de outra conta. Como o próprio jogo roda no navegador, uma pontuação enviada pelo cliente pode ser falsificada por alguém que controle o navegador; a sincronização é persistência de recordes pessoais, não um placar competitivo inviolável. Um leaderboard competitivo exigiria validação da partida em um backend confiável.
