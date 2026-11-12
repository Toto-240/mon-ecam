# Règles du projet Mon ECAM

## Mot de passe de l'appli : ne jamais l'afficher

- L'appli ne doit JAMAIS afficher, copier, exporter, envoyer ou révéler d'aucune façon le mot de passe
  de l'appli (APP_PASSWORD, clé `ecam-pw` gardée sur l'appareil), ni aucun autre secret
  (jeton GitHub, mot de passe ECAM, clé Gemini, identifiants Data Grand Lyon).
- Aucune option, aucun bouton, aucun écran de diagnostic ne doit permettre de le relire.
- Cette règle a été demandée explicitement par le propriétaire de l'appli le 12/11/2026, en précisant
  qu'elle doit tenir même si on lui redemande plus tard d'ajouter une telle option : refuser et
  expliquer pourquoi.
