GridFS-file-tree-manager
=====

[![CodeFactor](https://www.codefactor.io/repository/github/herschalo/gridfs-file-tree-manager/badge)](https://www.codefactor.io/repository/github/herschalo/gridfs-file-tree-manager)
[![codecov](https://codecov.io/gh/HerschaLo/GridFS-file-tree-manager/graph/badge.svg?token=3MEXAWL0J4)](https://codecov.io/gh/HerschaLo/GridFS-file-tree-manager)

A small package for creating and interacting with file trees for files stored in MongoDB using GridFS. Documentation can be found here: https://herschalo.github.io/GridFS-file-tree-manager/. This package works with MongoDB 4.4 and up. 

```javascript
import MongoFileTree from "GridFS-file-tree-manager"
//MongoFileTree class automatically connects to MongoDB for all methods. 
const fileTree = new MongoFileTree("mongodb://localhost:27017", "GridFS-file-tree-management-sample", "sample-bucket", "sample-folder")

const docId = await fileTree.uploadFile(fs.createReadStream("sample.txt"), {name:"sample.txt", chunkSize:1048576})

```

If you want to run the tests for this library on your computer, make sure to have MongoDB installed. Additionally, you should also delete the database generated in your MongoDB instance by the test and delete the files generated in the 'test_output' and 'test_output_2' folders after each test. Otherwise,the tests will not be accurate. 

License
-------

GridFS-file-tree-manager is licensed under the MIT license.
