var express = require('express');
var router = express.Router();
var MongoClient = require('mongodb').MongoClient;
var async = require('async');

var mongohost = 'localhost:27017';
var mongodb = 'backupDB';
var mongoConnection = 'mongodb://' + mongohost + '/' + mongodb;


/* GET home page. */
router.get('/', function(req, res, next) {
    MongoClient.connect(mongoConnection, function(err, db) {
        
        if (err) {
            console.log(err);
            res.send(err);
            return;
        }
        
        // get all targets
        var backups = db.collection('backups');
        backups.aggregate([
            {
                $group: {
                    _id: "$targetId",
                    name: { $first: "$name" },
                    //count: {$sum: 1},
                    //backupEndDate: { $first: "$backupEndDate" }
                }
            },
            {
                $sort: {"name": 1}
            }
        ]).toArray(function(err, targetResult) {
            
            // get data for each target
            var targetList = [];
            async.each(targetResult, function(targetResult, cb) {
                var targetId = targetResult._id;
                var backups = db.collection('backups');
                backups.find({
                    targetId: targetId,
                }, {
                    limit: 99, 
                    fields: {fileList: 0}, 
                    sort: {"backupEndDate": 1}
                }).toArray(function(err, dataResult) {
                    var data = {
                        targetId: targetId,
                        targetName: targetResult.name,
                        sourceFilesSize: [],
                        archivePhysicalSize: [],
                        writtenKb: [],
                        duration: []
                    };
                    
                    for (var j = 0; j < dataResult.length; j++) {
                        data.sourceFilesSize.push([dataResult[j].backupEndDate, dataResult[j].sourceFilesSize]);
                        data.archivePhysicalSize.push([dataResult[j].backupEndDate, dataResult[j].archivePhysicalSize]);
                        data.writtenKb.push([dataResult[j].backupEndDate, dataResult[j].writtenKb]);
                        
                        // calc duration of the backup
                        var start = new Date(dataResult[j].backupStartDate).getTime();
                        var end = new Date(dataResult[j].backupEndDate).getTime();
                        var duration = (end - start)/1000/60;
                        data.duration.push([dataResult[j].backupEndDate, duration]);
                    }
                    targetList.push(data);
                    cb();
                });    
            }, function(){
                db.close();
                res.render('index', { backupTargets: targetResult, targetData: targetList});
                
            });
        });
    });
});

module.exports = router;
