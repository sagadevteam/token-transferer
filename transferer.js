let Guard = require('web3-guard')
let Web3 = require('web3')
const env = require('./env')
const mysql = require('mysql')
let BigNumber = require('bignumber.js')

const HotelCal = require('./abi/HotelCal.json')
const SAGAPoint = require('./abi/SAGApoint.json')

const web3 = new Web3(new Web3.providers.HttpProvider(env.web3Url))
const HotelCalABI = HotelCal.abi
const hotel = web3.eth.contract(HotelCalABI).at(env.hotelContract)

const SAGAPointABI = SAGAPoint.abi
const point = web3.eth.contract(SAGAPointABI).at(env.sagaPointContract)

const dbconfig = env.dbconfig

var db = mysql.createConnection({
  host: dbconfig.host,
  user: dbconfig.user,
  password: dbconfig.password,
  database: dbconfig.database
})

db.connect()

let getRecentTickets = async () => {
  return new Promise ((resolve, reject) => {
    let getRecentSoldTicketsSQL = `SELECT
                                    u.eth_addr as 'user_address',
                                    t.ticket_id as 'token_id',
                                    i.price as 'ticket_price'
                                   FROM tickets as t
                                   INNER JOIN inventories as i on (t.inventory_id = i.inventory_id)
                                   INNER JOIN users as u on (t.user_id = u.user_id)
                                   WHERE t.to_user = '0'
                                   AND unix_timestamp() >= (t.time - 7 * 86400)`

    db.query(getRecentSoldTicketsSQL, (err, results) => {
      if (err) {
        reject(err)
      } else {
        resolve(results)
      }
    })
  })
}

let updateTicketToOnChain = async (tokenID) => {
  return new Promise ((resolve, reject) => {
    let updateSQL = `UPDATE tickets
                    SET to_user = 1
                    WHERE ticket_id = '${tokenID}'`

    db.query(updateSQL, (err, result) => {
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    })
  })
}

let main = async () => {
  let rows = await getRecentTickets()
  rows.forEach(async (row, index) => {
    let { user_address, token_id, ticket_price } = row
    // transfer ERC721 to user_address
    console.log(user_address, token_id, ticket_price)

    let guard = new Guard(web3)
    let confirmations = 12
    guard = guard.bind(index).confirm(confirmations)

    let txHash = await hotel.safeTransferFrom(
      web3.eth.coinbase,
      user_address,
      token_id,
      {
        from: web3.eth.coinbase, 
        to: hotel.address,
        gas: 470000
      }
    )

    console.log(txHash)

    guard.do(txHash)

    guard
    .on(hotel, hotel.Transfer().watch(async (err, event) => {
      if (err) console.error(err)
      if (!event.confirmed) {
        console.log('Not confirm ticket transfer: ' + event.transactionHash)
        guard.wait(event)
      } else {
        console.log('confirm ticket transfer: ' + event.transactionHash)
        let price = new BigNumber(ticket_price)
        let decimals = await point.decimals()
        decimals = parseInt(decimals)
        ten = new BigNumber(10)
        let priceUnitOnContract = price.multipliedBy(ten.pow(decimals))
        priceUnitOnContract = priceUnitOnContract.toString()
        let txHash = await point.burn(
          web3.eth.coinbase,
          priceUnitOnContract,
          {
            from: web3.eth.coinbase, 
            to: point.address,
            gas: 470000
          }
        )
        console.log('burn admin token: ' + txHash)
        guard.do(txHash)
      }
    })).on(point, point.Burn().watch(async (err, event) => {
      if (err) console.error(err)
      if (!event.confirmed) {
        guard.wait(event)
      } else {
        await updateTicketToOnChain(token_id)
        guard = null
      }
    }))
  })

  setInterval(async () => {
    let rows = await getRecentTickets()
    rows.forEach(async (row, index) => {
      let { user_address, token_id, ticket_price } = row

      let guard = new Guard(web3)
      let confirmations = 12

      guard = guard.confirm(confirmations).bind(index)

      let txHash = await hotel.safeTransferFrom(
        web3.eth.coinbase,
        user_address,
        token_id,
        {
          from: web3.eth.coinbase, 
          to: hotel.address,
          gas: 470000
        }
      )

      guard.do(txHash)

      guard
      .on(hotel, hotel.Transfer().watch(async (err, event) => {
        if (err) console.error(err)
        if (!event.confirmed) {
          guard.wait(event)
        } else {
          let price = new BigNumber(ticket_price)
          let decimals = await point.decimals()
          decimals = parseInt(decimals)
          ten = new BigNumber(10)
          let priceUnitOnContract = price.multipliedBy(ten.pow(decimals))
          priceUnitOnContract = priceUnitOnContract.toString()

          let txHash = await point.burn(
            web3.eth.coinbase,
            priceUnitOnContract,
            {
              from: web3.eth.coinbase, 
              to: point.address,
              gas: 470000
            }
          )
          guard.do(txHash)
        }
      })).on(point, point.Burn().watch(async (err, event) => {
        if (err) console.error(err)
        if (!event.confirmed) {
          guard.wait(event)
        } else {
          await updateTicketToOnChain(token_id)
          guard = null
        }
      }))
    })
  }, 60000)
}

main()
