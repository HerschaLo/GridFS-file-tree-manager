GridFS-folder-manager
=====
A small package for creating and interacting with folder trees for files stored in MongoDB using GridFS. 

```javascript
import FolderTree from "GridFS-folder-manager"
//FolderTree class automatically connects to MongoDB for all methods. 
const folders = new FolderTree("mongodb://localhost:27017", "GridFS-folder-management-sample", "sample-bucket", "sample-folder")

const docId = await folders.uploadFile(fs.createReadStream("sample.txt"), {name:"sample.txt", chunkSize:1048576})

```

If you want to run the tests for this library on your computer, make sure to have MongoDB installed. Additionally, you should also delete the database generated in your MongoDB instance by the test and delete the files generated in the 'test_output' and 'test_output_2' folders after each test. Otherwise,the tests will not be accurate. 

License
-------

GridFS-folder-manager is licensed under the MIT license.