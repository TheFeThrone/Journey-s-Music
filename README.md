# Journey's Music

![Frieren Searching](frieren_analysis.gif)

> ✨Frieren analyses any Song she listens to on her Journeys and makes them accessible for everyone!✨🎶
> 
> Selectable Musicplatforms:  
> 
> `Spotify`, `Tidal`, `Amazon Music`, `YouTube Music`, `YouTube`, `Apple Music`, `Deezer`, `SoundCloud`, `Anghami`, `Audiomack`, `Pandora`, `Yandex`

## Functions & Commands
### analyze music
Any message sent that includes a share link of a music platform gets processed to:
1. Get the share link
2. Send a spotify embed if it was not spotify so that a demo can be listened to
3. The Title and Artist(s) are shown with Link Buttons below them reaching to every enabled music platform

This works by using the API of https://song.link/ aka. https://odesli.co/ to search for existing platforms

### /platforms
Toggle which platforms to show as link buttons under the embed

## TODO
- [ ] Work with a database instead of a .json thats rewritten 
