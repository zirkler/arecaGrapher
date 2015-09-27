- ``$ git clone https://github.com/TheJetlag/arecaGrapher.git``
- To gain acces to your account via the Gmail API, go to https://console.developers.google.com/project and follow these instructions:
    - Create a new project
    - In the Sidebar click on ``APIs and Authentication`` -> ``APIs`` -> ``Gmail API``
    - ``Activate API``
    - Click ``Credentials`` in the Sidebar
    - ``Add Credentials`` -> ``OAuth 2.0-Client-ID``
    - Follow the Instructions for creating the agreement screen
    - Back on the credentials screen select ``other``as application type and give it a name
    - now download the Client ID as json, rename it as ``client_secret.json`` and move it to the arecaGrapher directory.
- If you haven't running a MongoDB instance, get one up and running.
- ``$ npm install``
- run ``$ node collectData.js`` for the first time.
- ``$ npm start`` or ``$ node ./bin/www`` for starting the webserver and the cronjob for collecting data. Maybe you want to run this in a ``screen``.

![Graph](https://raw.githubusercontent.com/TheJetlag/arecaGrapher/master/assets/graph.png)
