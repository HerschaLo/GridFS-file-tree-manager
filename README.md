GridFS-folder-manager
=====
A library for creating and managing folder trees for files stored in MongoDB using GridFS. 

```javascript
import FolderTree from "GridFS-folder-manager"
//FolderTree class automatically connects to MongoDB for all methods. 
const folders = new FolderTree("mongodb://localhost:27017", "GridFS-folder-management-sample", "sample-bucket", "sample-folder")

const docId = await folders.uploadFile(fs.createReadStream("sample.txt"))

```

If you want to run the tests for this library, make sure to have MongoDB installed on your computer. Additionally, you should also delete the output in the 'test_output' and 'test_output_2' folders after each test; otherwise the tests will not be valid. 