# Birdsong Neon Graph

Progetto web per Visual Studio Code: ascolta il microfono, filtra la banda tipica dei versi degli uccelli e trasforma i picchi in un grafo neon in tempo reale.

## Come avviarlo

1. Apri questa cartella in Visual Studio Code.
2. Avvia un server locale dalla cartella:

```bash
python3 -m http.server 5173
```

3. Apri `http://localhost:5173` nel browser.
4. Premi `Microfono` e consenti l'accesso.

Puoi anche usare l'estensione Live Server di VS Code.

## Note

Il riconoscimento e' fatto con analisi del segnale: energia nella banda alta, picchi stretti, variazione spettrale e filtro anti-rumore basso. Funziona bene per cinguettii e trilli, ma non e' un classificatore scientifico di specie. Per un riconoscimento davvero robusto in ambienti rumorosi servirebbe integrare un modello addestrato, per esempio BirdNET o un modello TensorFlow.js.
