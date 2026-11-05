# ♠ Odds Lab — Calculadora de Poker

App web (Texas Hold'em) que calcula as tuas probabilidades de ganhar e explica, passo a passo, como chegou ao resultado.

## Funcionalidades

- **Mesa interativa**: escolhe o nº de jogadores (2–10), as tuas 2 cartas e o flop, turn e river com um seletor de cartas.
- **Equity** (a tua fatia do pote a longo prazo) com gráfico animado, % de ganhar / empatar / perder e comparação com a "parte justa" (1 ÷ nº de jogadores).
- **Cálculo exato** quando há 1 adversário e o número de cenários é pequeno (ex.: todo o flop heads-up = 1 070 190 cenários); **simulação de Monte Carlo** (80 000–150 000 mãos) nos restantes casos, com margem de erro.
- **Outs**: cartas que melhoram a tua mão, agrupadas por jogo, com % na próxima carta, % até ao river e a regra do 2/4.
- **Distribuição**: probabilidade de acabares com cada jogo e com que mãos te costumam vencer.
- **Folds e apostas na mesa**: toca num adversário para o marcar como *apostou* ou *fold*. Quem desistiu sai do cálculo; quem apostou recebe uma mão forte (top ~18% pré-flop, top pair ou melhor / projeto forte depois do flop) ou, na percentagem de bluff que escolheres, uma mão fraca. A explicação compara com o resultado sem folds e contra mãos aleatórias.
- **Pagar ou fazer bluff?**
  - *Pagar*: diz se pagar uma aposta é lucrativo (equity necessária, EV) e quantas vezes o adversário tem de estar a fazer bluff.
  - *Fazer bluff*: quantas vezes os adversários têm de desistir para o teu bluff compensar (bluff puro e semi-bluff com a tua equity) e o EV para a tua estimativa.
- **"Como calculei"**: explicação com as fórmulas e números reais da tua mão.
- **Ranking das mãos** com exemplos e frequência.
- Botões de mão aleatória e "próxima rua" para treinar. Funciona offline (PWA).

## Correr

Sem dependências nem build:

```bash
python3 -m http.server 8080
# abre http://localhost:8080
```

Testes do motor: `node test/engine.test.js`

Para usar no telemóvel, publica com **GitHub Pages** (Settings → Pages → Deploy from branch) e adiciona ao ecrã principal.

## Ficheiros

- `engine.js` — avaliador de mãos, equity (exata + Monte Carlo), outs.
- `app.js` — interface e explicações.
- `styles.css`, `index.html` — visual e animações.

> A equity assume que os adversários têm mãos aleatórias. Contra jogadores que apostam forte, ajusta para baixo.
