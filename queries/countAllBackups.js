use backupDB;
db.backups.aggregate([
    {
        $sort: {"backupEndDate": -1}
    },
    {
        $group: {
            _id: "$targetId",
            name: { $first: "$name" },
            count: {$sum: 1},
            backupEndDate: { $first: "$backupEndDate" }
        }
    },
    
]);
