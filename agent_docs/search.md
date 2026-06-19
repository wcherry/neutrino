# Search

My suggested architecture is:
* Search index should be stored on the client - every user has their own index
* Every save should create a background process to update the search index
* Perodically the database should be saved encrypted to the server for sync to other clients
  * Files should be hidden, use the unix style (first chracter is a period makes the file hidden)
* A server side event can be used to notify all other clients that the user's search index has been 
* Shared files can be added to the search index - this will required a background fetch and index.

Required core functinality change:
* We should be able to reject a save if a file is older then the file already on the server. 
* We need a new token to that should match when the user tries to save. 
* Reject if not a match. Provide an override flag that will force a save.
* It's up to the client to handle the rejection state.
* This should be fairly rare.

