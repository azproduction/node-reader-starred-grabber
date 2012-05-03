Google Reader starred grabber for Node.js
=========================================

This script grabs/updates all your starred items

**Usage**

`node favs.js -db favs.json -e your_google_login -p your_google_password -l`

**favs.json format**

```javascript
{
    "google_reader_item_id": { // tag:google.com,2005:reader/item/ddc705e8894acac5
        original: "http://original.source.com/path/to/page.html",
        images: ["http://pewpew.com/ololo.jpg"]
    }
}
```

**Note**: create 2-step auth password for security reasons