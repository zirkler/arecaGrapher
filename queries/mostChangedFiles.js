use backupDB;
db.backups.aggregate([
    {
        $unwind: "$fileList"
    },
    {
        $group: {
            _id: {file: "$fileList", targetId: "$targetId"},
            changes: {$sum: 1},
        }
    },
    {
        $sort: {"changes": -1}
    }
]);
